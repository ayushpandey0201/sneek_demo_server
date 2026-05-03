const { decryptPayload, signCallbackPayload, canonicalize, sha256Hex } = require('../shared/crypto');
const { verifyHMAC, verifyKID, verifyScanOrigin } = require('../shared/securityChecks');

const DEMO_MOBILE_TOKEN = 'demo-mobile-token';
const locallyConsumedSessions = new Set();

const CLIENT_ID       = process.env.CLIENT_ID        || 'spotify_123';
const CLIENT_KID      = process.env.CLIENT_KID       || 'spotify.com';
const CLIENT_K1       = process.env.CLIENT_K1        || 'secretkey';
const CALLBACK_SECRET = process.env.CALLBACK_SECRET  || 'spotify-callback-secret';
const CLIENT_NAME     = process.env.CLIENT_NAME      || 'Spotify';

const CLIENT_ALLOWED_ORIGINS = (process.env.CLIENT_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const ALLOW_SCAN_WITHOUT_ORIGIN = String(process.env.ALLOW_SCAN_WITHOUT_ORIGIN || '').toLowerCase() === 'true';

const clients = new Map([
  [
    CLIENT_ID,
    {
      clientId: CLIENT_ID,
      displayName: CLIENT_NAME,
      kid: CLIENT_KID,
      k1: CLIENT_K1,
      callbackSecret: CALLBACK_SECRET,
      allowedOrigins: CLIENT_ALLOWED_ORIGINS,
    },
  ],
]);

function logStep(actor, message) {
  console.log(`[${actor}] ${message}`);
}

function createInitialVerification() {
  return {
    mobileToken: 'pending',
    decrypt: 'pending',
    hmac: 'pending',
    kid: 'pending',
    origin: 'pending',
    ttl: 'pending',
    replay: 'pending',
    callbackSignature: 'pending',
    sessionCrossCheck: 'pending',
    payloadDigestMatch: 'pending',
    blobDigestMatch: 'pending',
    crossVerifySummary: 'pending',
  };
}

function isExpiredSignal(bridgeResult) {
  const reason = bridgeResult?.body?.reason || bridgeResult?.body?.error || '';
  return bridgeResult?.status === 410 || String(reason).toLowerCase().includes('expired');
}

function isReplaySignal(bridgeResult) {
  const reason = bridgeResult?.body?.reason || bridgeResult?.body?.error || '';
  return bridgeResult?.status === 409 || String(reason).toLowerCase().includes('replay');
}

function deriveExpectedPayloadDigest(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const payloadForDigest = { ...payload };
  delete payloadForDigest.hmac;
  delete payloadForDigest.payloadDigest;
  delete payloadForDigest.payload_digest;
  return sha256Hex(canonicalize(payloadForDigest));
}

function isPayloadExpired(expiresAt) {
  if (!expiresAt) return false;
  const expiryMillis = Date.parse(expiresAt);
  if (Number.isNaN(expiryMillis)) {
    return true;
  }
  return Date.now() > expiryMillis;
}

async function postToClientServer(path, payload, extraHeaders = {}) {
  const clientServerUrl = process.env.CLIENT_SERVER_URL;
  if (!clientServerUrl) {
    return { skipped: true, reason: 'missing_CLIENT_SERVER_URL' };
  }

  const normalizedBase = clientServerUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = `${normalizedBase}${normalizedPath}`;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get('content-type') || '';
    const responseBody = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return {
      skipped: false,
      ok: response.ok,
      status: response.status,
      body: responseBody,
      url: targetUrl,
    };
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      status: 0,
      error: error?.message || 'network_error',
      url: targetUrl,
    };
  }
}

function buildVerificationDisplay(body) {
  const verifierName =
    body?.verifierName != null && String(body.verifierName).trim()
      ? String(body.verifierName).trim()
      : null;
  const message =
    body?.verificationMessage != null && String(body.verificationMessage).trim()
      ? String(body.verificationMessage).trim()
      : null;
  if (!verifierName && !message) return null;
  return { verifierName, message };
}

async function processSneekScan(body, requestMeta = {}) {
  const { origin: requestOrigin } = requestMeta;
  const { encryptedBlob, username, mobileToken, userId, name, email, verifierName, verificationMessage } =
    body || {};
  const verificationDisplay = buildVerificationDisplay({ verifierName, verificationMessage });
  logStep('SNEEK', 'Scan/Verify request received');
  
  if (!encryptedBlob) {
    return { status: 400, body: { ok: false, error: 'encryptedBlob is required.' } };
  }

  const verification = createInitialVerification();

  if (!mobileToken || mobileToken !== DEMO_MOBILE_TOKEN) {
    verification.mobileToken = 'failed';
    return { status: 401, body: { ok: false, error: 'Invalid mobile token.', verification } };
  }
  verification.mobileToken = 'passed';

  let decryptedPayload;
  try {
    decryptedPayload = decryptPayload(encryptedBlob);
    verification.decrypt = 'passed';
    logStep('SNEEK', 'Decrypted payload successfully.');
  } catch (_error) {
    verification.decrypt = 'failed';
    return { status: 400, body: { ok: false, error: 'Sneek could not decode the QR payload.', verification } };
  }

  const client = clients.get(decryptedPayload.client_id);
  if (!client) {
    verification.hmac = 'failed';
    return { status: 404, body: { ok: false, error: 'Unknown client_id in decrypted payload.', verification } };
  }

  const hmacCheck = verifyHMAC(decryptedPayload, client.k1);
  if (!hmacCheck.ok) {
    verification.hmac = 'failed';
    return { status: 401, body: {
      ok: false,
      error: 'HMAC verification failed.',
      expectedHmac: hmacCheck.expectedHmac,
      receivedHmac: hmacCheck.receivedHmac,
      verification
    }};
  }
  verification.hmac = 'passed';
  logStep('SNEEK', 'HMAC verified.');

  const kidCheck = verifyKID(decryptedPayload, client.kid);
  if (!kidCheck.ok) {
    verification.kid = 'failed';
    return { status: 401, body: {
      ok: false,
      error: 'KID verification failed.',
      registeredKid: kidCheck.expectedKid,
      receivedKid: kidCheck.receivedKid,
      verification
    }};
  }
  verification.kid = 'passed';
  logStep('SNEEK', 'KID verified.');

  const originCheck = verifyScanOrigin(requestOrigin, client.allowedOrigins, {
    allowMissingOrigin: ALLOW_SCAN_WITHOUT_ORIGIN,
  });
  if (originCheck.skipped) {
    verification.origin = 'skipped';
  } else if (!originCheck.ok) {
    verification.origin = 'failed';
    return {
      status: 403,
      body: {
        ok: false,
        error:
          originCheck.reason === 'missing_origin'
            ? 'Origin header required for this client.'
            : 'Origin is not allowed for this client (CORS / allowlist).',
        receivedOrigin: requestOrigin || null,
        allowedOrigins: client.allowedOrigins,
        decryptedPayload,
        verification,
      },
    };
  } else {
    verification.origin = 'passed';
    logStep('SNEEK', 'Request Origin allowlisted for client.');
  }

  const expectedPayloadDigest = deriveExpectedPayloadDigest(decryptedPayload);
  const receivedPayloadDigest = decryptedPayload.payloadDigest || decryptedPayload.payload_digest || null;
  if (receivedPayloadDigest) {
    verification.payloadDigestMatch = receivedPayloadDigest === expectedPayloadDigest ? 'passed' : 'failed';
  } else {
    verification.payloadDigestMatch = 'passed';
  }

  const expectedBlobDigest = sha256Hex(encryptedBlob);
  const receivedBlobDigest = decryptedPayload.blobDigest || decryptedPayload.blob_digest || null;
  if (receivedBlobDigest) {
    verification.blobDigestMatch = receivedBlobDigest === expectedBlobDigest ? 'passed' : 'failed';
  } else {
    verification.blobDigestMatch = 'passed';
  }

  const displayName = username || name || 'Demo User';
  const normalizedName = String(displayName).trim();
  const normalizedUserId = String(userId || username || 'demo_user').trim();
  const normalizedEmail = String(email || `${normalizedUserId || 'demo'}@sneekauth.com`).trim();
  const userProfile = {
    userId: normalizedUserId || 'demo_user',
    name: normalizedName || 'Demo User',
    email: normalizedEmail || 'demo@sneekauth.com',
  };
  
  const sharedInfo = {
    verifiedAt: new Date().toISOString(),
    clientName: client.displayName,
    permissions: ['Read Profile', 'Verify Identity']
  };

  const sessionId = decryptedPayload.session_id || decryptedPayload.sessionId || null;
  const expiresAt = decryptedPayload.expires_at || decryptedPayload.expiresAt || null;

  if (isPayloadExpired(expiresAt)) {
    verification.ttl = 'failed';
    verification.replay = 'pending';
    verification.sessionCrossCheck = 'failed';
    verification.callbackSignature = 'pending';
    verification.crossVerifySummary = 'failed';
    return {
      status: 410,
      body: {
        ok: false,
        error: 'Session has expired.',
        decryptedPayload,
        verification,
        clientBridge: {
          verifySession: { skipped: true, reason: 'local_payload_ttl_failed' },
          verificationSync: { skipped: true, reason: 'local_payload_ttl_failed' },
          callback: { skipped: true, reason: 'local_payload_ttl_failed' },
        },
      },
    };
  }

  if (sessionId && locallyConsumedSessions.has(sessionId)) {
    verification.ttl = 'passed';
    verification.replay = 'failed';
    verification.sessionCrossCheck = 'failed';
    verification.callbackSignature = 'pending';
    verification.crossVerifySummary = 'failed';
    return {
      status: 409,
      body: {
        ok: false,
        error: 'Replay detected for this session.',
        decryptedPayload,
        verification,
        clientBridge: {
          verifySession: { skipped: true, reason: 'local_replay_check_failed' },
          verificationSync: { skipped: true, reason: 'local_replay_check_failed' },
          callback: { skipped: true, reason: 'local_replay_check_failed' },
        },
      },
    };
  }

  // Note: callbackPayload and signature are built AFTER all verification
  //       mutations below, so that the signature covers the final gate states.

  const verifySessionResult = await postToClientServer('/verify-session', {
    session_id: sessionId,
    client_id: decryptedPayload.client_id,
  });

  if (verifySessionResult.skipped) {
    verification.ttl = 'passed';
    verification.replay = 'passed';
    verification.sessionCrossCheck = 'passed';
  } else if (!verifySessionResult.ok && isExpiredSignal(verifySessionResult)) {
    verification.ttl = 'failed';
    verification.replay = 'pending';
    verification.sessionCrossCheck = 'failed';
  } else if (!verifySessionResult.ok && isReplaySignal(verifySessionResult)) {
    verification.ttl = 'passed';
    verification.replay = 'failed';
    verification.sessionCrossCheck = 'failed';
  } else if (!verifySessionResult.ok) {
    verification.ttl = 'failed';
    verification.replay = 'failed';
    verification.sessionCrossCheck = 'failed';
  } else {
    verification.ttl = 'passed';
    verification.replay = 'passed';
    const serverSessionId =
      verifySessionResult.body?.session_id ||
      verifySessionResult.body?.sessionId ||
      verifySessionResult.body?.session?.session_id ||
      verifySessionResult.body?.session?.sessionId ||
      null;
    verification.sessionCrossCheck = !sessionId || !serverSessionId || sessionId === serverSessionId
      ? 'passed'
      : 'failed';
  }

  const verificationSyncPayload = {
    session_id: sessionId,
    verification,
    client_id: decryptedPayload.client_id,
    userProfile,
    sharedInfo,
    verificationDisplay,
  };
  const verificationSyncResult = await postToClientServer('/sneek/verification-sync', verificationSyncPayload);

  // Build and sign callback payload AFTER all verification gates are resolved
  const callbackPayload = {
    session_id: sessionId,
    client_id: decryptedPayload.client_id,
    userProfile,
    sharedInfo,
    verificationDisplay,
    verification: { ...verification },
  };
  const callbackSignature = signCallbackPayload(callbackPayload, client.callbackSecret);
  const callbackResult = await postToClientServer('/sneek/callback', callbackPayload, {
    'x-sneek-signature': callbackSignature,
  });

  verification.callbackSignature = callbackResult.skipped || callbackResult.ok ? 'passed' : 'failed';

  const crossChecks = [
    verification.sessionCrossCheck,
    verification.payloadDigestMatch,
    verification.blobDigestMatch,
  ];
  verification.crossVerifySummary = crossChecks.every((status) => status === 'passed') ? 'passed' : 'failed';

  const clientBridge = {
    verifySession: verifySessionResult,
    verificationSync: verificationSyncResult,
    callback: callbackResult,
  };

  if (verification.ttl === 'failed' || verification.replay === 'failed') {
    return {
      status: verification.ttl === 'failed' ? 410 : 409,
      body: {
        ok: false,
        error: verification.ttl === 'failed' ? 'Session has expired.' : 'Replay detected for this session.',
        decryptedPayload,
        verification,
        clientBridge,
      },
    };
  }

  if (verification.callbackSignature === 'failed') {
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Callback signature verification failed at client server.',
        decryptedPayload,
        verification,
        clientBridge,
      },
    };
  }

  if (verification.payloadDigestMatch === 'failed' || verification.blobDigestMatch === 'failed') {
    return {
      status: 401,
      body: {
        ok: false,
        error: 'Cross-verification digest mismatch.',
        decryptedPayload,
        verification,
        clientBridge,
      },
    };
  }

  if (sessionId) {
    locallyConsumedSessions.add(sessionId);
  }

  return {
    status: 200,
    body: {
      ok: true,
      message: 'Sneek verified the QR blob successfully.',
      decryptedPayload,
      verification,
      userProfile,
      sharedInfo,
      verificationDisplay,
      authenticatedClient: {
        client_id: client.clientId,
        displayName: client.displayName,
        kid: client.kid,
      },
      clientBridge,
    },
  };
}

module.exports = { processSneekScan };

const { decryptPayload, signCallbackPayload } = require('../shared/crypto');
const { verifyHMAC, verifyKID } = require('../shared/securityChecks');

const DEMO_MOBILE_TOKEN = 'demo-mobile-token';

const clients = new Map([
  [
    'spotify_123',
    {
      clientId: 'spotify_123',
      displayName: 'Spotify',
      kid: 'spotify.com',
      k1: 'secretkey',
      callbackSecret: 'spotify-callback-secret',
    },
  ],
]);

function logStep(actor, message) {
  console.log(`[${actor}] ${message}`);
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

async function processSneekScan(body) {
  const { encryptedBlob, username } = body || {};
  logStep('SNEEK', 'Scan/Verify request received');
  
  if (!encryptedBlob) {
    return { status: 400, body: { ok: false, error: 'encryptedBlob is required.' } };
  }

  const verification = {
    decrypt: 'pending',
    hmac: 'pending',
    kid: 'pending',
  };

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

  const userProfile = {
    userId: username || 'demo_user',
    name: username ? username.charAt(0).toUpperCase() + username.slice(1) : 'Demo User',
    email: `${username || 'demo'}@sneekauth.com`,
  };
  
  const sharedInfo = {
    verifiedAt: new Date().toISOString(),
    clientName: client.displayName,
    permissions: ['Read Profile', 'Verify Identity']
  };

  const sessionId = decryptedPayload.session_id || decryptedPayload.sessionId || null;
  const verificationSyncPayload = {
    session_id: sessionId,
    verification,
    client_id: decryptedPayload.client_id,
    userProfile,
    sharedInfo,
  };
  const callbackPayload = {
    session_id: sessionId,
    client_id: decryptedPayload.client_id,
    userProfile,
    sharedInfo,
    verification,
  };
  const callbackSignature = signCallbackPayload(callbackPayload, client.callbackSecret);

  const clientBridge = {
    verifySession: await postToClientServer('/verify-session', {
      session_id: sessionId,
      client_id: decryptedPayload.client_id,
    }),
    verificationSync: await postToClientServer('/sneek/verification-sync', verificationSyncPayload),
    callback: await postToClientServer('/sneek/callback', callbackPayload, {
      'x-sneek-signature': callbackSignature,
    }),
  };

  return {
    status: 200,
    body: {
      ok: true,
      message: 'Sneek verified the QR blob successfully.',
      decryptedPayload,
      verification,
      userProfile,
      sharedInfo,
      clientBridge,
    },
  };
}

module.exports = { processSneekScan };

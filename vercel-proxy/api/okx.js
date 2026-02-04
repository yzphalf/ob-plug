const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');

// Initialize cors middleware
const corsHandler = cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'] // Client no longer sends OK-ACCESS headers
});

// Helper to handle Vercel's body parsing differences
const runMiddleware = (req, res, fn) => {
    return new Promise((resolve, reject) => {
        fn(req, res, (result) => {
            if (result instanceof Error) {
                return reject(result);
            }
            return resolve(result);
        });
    });
};

module.exports = async (request, response) => {
    // Handle pre-flight CORS requests
    await runMiddleware(request, response, corsHandler);

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    const { OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE } = process.env;

    if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE) {
        return response.status(500).json({
            error: 'OKX credentials not configured on server. Please add OKX_API_KEY, OKX_SECRET_KEY, and OKX_PASSPHRASE to Vercel Environment Variables.'
        });
    }

    const { method, url, body } = request;

    // Extract basic path (strip /okx or /api/okx prefix)
    const urlObj = new URL(url, `http://${request.headers.host}`);
    let targetPath = urlObj.pathname + urlObj.search;

    if (targetPath.startsWith('/okx')) {
        targetPath = targetPath.replace('/okx', '');
    } else if (targetPath.startsWith('/api/okx')) {
        targetPath = targetPath.replace('/api/okx', '');
    }

    const targetUrl = `https://www.okx.com${targetPath}`;

    // Generate Signature
    const timestamp = new Date().toISOString();
    // For GET: query params are already in targetPath. For POST: body is the payload.
    const bodyString = method === 'GET' ? '' : (typeof body === 'object' ? JSON.stringify(body) : body || '');

    const message = `${timestamp}${method}${targetPath}${bodyString}`;
    const signature = crypto.createHmac('sha256', OKX_SECRET_KEY).update(message).digest('base64');

    console.log(`[OKX Proxy] Forwarding ${method} to ${targetPath}`);

    const config = {
        method: method,
        url: targetUrl,
        headers: {
            'Content-Type': 'application/json',
            'OK-ACCESS-KEY': OKX_API_KEY,
            'OK-ACCESS-SIGN': signature,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
            'x-simulated-trading': process.env.OKX_SIMULATED === '1' ? '1' : undefined
        },
        data: bodyString ? bodyString : undefined,
        validateStatus: () => true
    };

    try {
        const okxResponse = await axios(config);
        response.status(okxResponse.status).json(okxResponse.data);
    } catch (error) {
        console.error('[OKX Proxy] Request failed:', error.message);
        if (error.response) {
            response.status(error.response.status).json(error.response.data);
        } else {
            response.status(502).json({ error: 'Bad Gateway: Failed to connect to OKX' });
        }
    }
};

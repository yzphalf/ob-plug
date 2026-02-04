const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

// Initialize cors middleware
const corsHandler = cors({ origin: true });

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
    console.log(`[ENTRY] Received ${request.method} request for ${request.url}`);
    // Handle pre-flight CORS requests
    await runMiddleware(request, response, corsHandler);

    const { method, url, body } = request;
    const { BINANCE_API_KEY, BINANCE_SECRET_KEY } = process.env;

    if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
        return response.status(500).json({ 
            error: 'API keys not configured on server. Go to Vercel Project Settings > Environment Variables to add BINANCE_API_KEY and BINANCE_SECRET_KEY.' 
        });
    }

    // Use URL and URLSearchParams for robust parsing
    const incomingUrl = new URL(url, `http://${request.headers.host}`);
    const queryParams = incomingUrl.searchParams;
    let path = queryParams.get('path') || incomingUrl.pathname;
    // Ensure the path starts with a slash
    if (!path.startsWith('/')) {
        path = `/${path}`;
    }
    queryParams.delete('path');
    
    // Determine if it's futures API
    const isFutures = path.startsWith('/fapi/');
    const baseUrl = isFutures ? 'https://fapi.binance.com' : 'https://api.binance.com';

    // Define a whitelist of endpoints that do not require a signature
    const noSignatureEndpoints = [
        '/api/v3/ping',
        '/api/v3/time',
        '/api/v3/exchangeInfo',
        '/fapi/v1/ping',
        '/fapi/v1/time',
        '/fapi/v1/exchangeInfo'
    ];

    let finalUrl;
    
    // Only add authentication parameters for endpoints that require a signature
    if (noSignatureEndpoints.includes(path)) {
        // For public endpoints, use the cleaned query params
        const queryString = queryParams.toString();
        finalUrl = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;
    } else {
        // For signed endpoints, add timestamp and signature
        queryParams.set('timestamp', Date.now());
        
        const queryToSign = queryParams.toString();
        const signature = crypto
            .createHmac('sha256', BINANCE_SECRET_KEY)
            .update(queryToSign)
            .digest('hex');
        
        queryParams.set('signature', signature);
        
        // Build the full URL
        finalUrl = `${baseUrl}${path}?${queryParams.toString()}`;
    }

    const config = {
        method: method,
        url: finalUrl,
        headers: {
            'X-MBX-APIKEY': BINANCE_API_KEY,
            'Content-Type': 'application/json',
        }
    };

    if (method.toUpperCase() !== 'GET') {
        config.data = body;
    }

    try {
        const binanceResponse = await axios(config);

        // 转发响应给客户端
        response.status(binanceResponse.status).json(binanceResponse.data);

    } catch (error) {
        if (error.response) {
            // Binance API返回了错误响应
            if (error.response.status === 401 && path !== '/api/v3/ping') {
                console.error('Authentication failed:', {
                    endpoint: path,
                    url: finalUrl,
                    response: error.response.data
                });
            }
            response.status(error.response.status).json(error.response.data);
        } else if (error.request) {
            // 没有收到响应
            console.error('No response received from Binance:', error.request);
            response.status(504).json({ 
                error: 'Gateway timeout: Could not connect to Binance API.' 
            });
        } else {
            // 请求配置问题
            console.error('Request error:', error.message);
            response.status(500).json({ 
                error: 'Error preparing request to Binance API.' 
            });
        }
    }
};
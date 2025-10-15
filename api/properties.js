// api/properties.js - Deploy this as a Vercel Serverless Function
// This middleware handles Vebra API authentication and returns JSON to Framer

const xml2js = require('xml2js');

// Your Vebra API credentials
const VEBRA_CONFIG = {
  username: 'PropLinkEst11UHxml',
  password: 'y9y4Djx38r1Qaxa',
  datafeedId: 'PropertyLEAPI',
  baseUrl: 'http://webservices.vebra.com/export/PropertyLEAPI/v10'
};

// Branch mapping - branchId to clientId
const BRANCH_MAP = {
  '1': '33273', // Lettings
  '2': '41620'  // Sales
};

// Token storage - persists across function calls in same instance
let tokenCache = {
  token: null,
  expires: null,
  lastError: null,
  lastErrorTime: null
};

// Function to get authentication token
async function getToken() {
  // Check if we have a valid cached token
  if (tokenCache.token && tokenCache.expires > Date.now()) {
    console.log('Using cached token (valid until:', new Date(tokenCache.expires).toISOString(), ')');
    return tokenCache.token;
  }

  // Check if we recently got a 401 (within last 5 minutes) - don't retry immediately
  if (tokenCache.lastError && tokenCache.lastErrorTime && 
      (Date.now() - tokenCache.lastErrorTime) < 5 * 60 * 1000) {
    console.log('Recently got 401 error, token may still be active on server');
    throw new Error('Token request failed recently. An active token may exist on the Vebra server. Please wait 5 minutes or use the set-token endpoint.');
  }

  console.log('Requesting new token...');
  
  const url = `${VEBRA_CONFIG.baseUrl}/branch`;
  const credentials = Buffer.from(`${VEBRA_CONFIG.username}:${VEBRA_CONFIG.password}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`
      }
    });

    console.log('Token response status:', response.status);

    // If 401, there might be an active token already
    if (response.status === 401) {
      console.error('Authentication failed - there may be an active token already');
      
      tokenCache.lastError = '401 Unauthorized';
      tokenCache.lastErrorTime = Date.now();
      
      throw new Error('Authentication failed - there may be an active token already. Vebra API only allows one token request per hour. Use the set-token endpoint to manually set a token.');
    }

    const token = response.headers.get('token') || response.headers.get('Token');
    
    if (token) {
      tokenCache.token = token;
      tokenCache.expires = Date.now() + (55 * 60 * 1000); // 55 minutes
      tokenCache.lastError = null;
      tokenCache.lastErrorTime = null;
      console.log('Token received and cached');
      return tokenCache.token;
    }
    
    throw new Error('No token received from API');
  } catch (error) {
    console.error('Token error:', error);
    throw error;
  }
}

// Function to fetch data from Vebra API
async function fetchVebraData(endpoint) {
  const token = await getToken();
  const url = `${VEBRA_CONFIG.baseUrl}${endpoint}`;

  console.log('Fetching:', url);

  // The Vebra API expects the token in the Authorization header
  // Format: Basic base64(token:) - note the colon with empty password
  const encodedToken = Buffer.from(`${token}:`).toString('base64');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${encodedToken}`
    }
  });

  console.log('Response status:', response.status);

  if (response.status === 401) {
    console.log('Token expired, clearing cache and retrying...');
    tokenCache.token = null;
    tokenCache.expires = null;
    
    // Retry once
    const newToken = await getToken();
    const newEncodedToken = Buffer.from(`${newToken}:`).toString('base64');
    
    const retryResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${newEncodedToken}`
      }
    });
    
    if (!retryResponse.ok) {
      throw new Error(`API error after retry: ${retryResponse.status}`);
    }
    
    const xmlData = await retryResponse.text();
    const parser = new xml2js.Parser({ explicitArray: false });
    return await parser.parseStringPromise(xmlData);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('API Error:', errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const xmlData = await response.text();
  const parser = new xml2js.Parser({ explicitArray: false });
  const jsonData = await parser.parseStringPromise(xmlData);
  
  return jsonData;
}

// Main handler
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { endpoint, branchId, propertyId, token } = req.query;

    console.log('Request:', { endpoint, branchId, propertyId });

    let data;

    switch (endpoint) {
      case 'set-token':
        // Manual token override
        if (!token) {
          return res.status(400).json({ error: 'token parameter required' });
        }
        
        tokenCache.token = token;
        tokenCache.expires = Date.now() + (55 * 60 * 1000);
        tokenCache.lastError = null;
        tokenCache.lastErrorTime = null;
        
        return res.status(200).json({ 
          success: true, 
          message: 'Token manually set and will be used for API requests',
          expiresAt: new Date(tokenCache.expires).toISOString()
        });

      case 'cache-status':
        // Check current cache status
        return res.status(200).json({
          hasToken: !!tokenCache.token,
          tokenPreview: tokenCache.token ? tokenCache.token.substring(0, 10) + '...' : null,
          expiresAt: tokenCache.expires ? new Date(tokenCache.expires).toISOString() : null,
          isExpired: tokenCache.expires ? tokenCache.expires < Date.now() : null,
          timeUntilExpiry: tokenCache.expires ? Math.floor((tokenCache.expires - Date.now()) / 1000 / 60) + ' minutes' : null,
          lastError: tokenCache.lastError,
          lastErrorTime: tokenCache.lastErrorTime ? new Date(tokenCache.lastErrorTime).toISOString() : null
        });

      case 'test-credentials':
        // Test endpoint to verify credentials
        const testUrl = `${VEBRA_CONFIG.baseUrl}/branch`;
        const testCreds = Buffer.from(`${VEBRA_CONFIG.username}:${VEBRA_CONFIG.password}`).toString('base64');
        
        const testResponse = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${testCreds}`
          }
        });
        
        const hasToken = !!testResponse.headers.get('token');
        
        return res.status(200).json({
          status: testResponse.status,
          statusText: testResponse.statusText,
          hasToken: hasToken,
          token: hasToken ? testResponse.headers.get('token') : null,
          message: hasToken ? 'Token received! Use set-token endpoint to cache it.' : 'No token received'
        });

      case 'branches':
        data = await fetchVebraData('/branch');
        break;

      case 'properties':
        if (!branchId) {
          return res.status(400).json({ error: 'branchId required (1 for Lettings, 2 for Sales)' });
        }
        
        const clientId = BRANCH_MAP[branchId];
        if (!clientId) {
          return res.status(400).json({ error: 'Invalid branchId. Use 1 for Lettings or 2 for Sales' });
        }
        
        console.log(`Fetching properties for branch ${branchId} (client ${clientId})`);
        data = await fetchVebraData(`/branch/${clientId}/property`);
        break;

      case 'property':
        if (!propertyId) {
          return res.status(400).json({ error: 'propertyId required' });
        }
        data = await fetchVebraData(`/property/${propertyId}`);
        break;

      case 'property-files':
        if (!propertyId) {
          return res.status(400).json({ error: 'propertyId required' });
        }
        data = await fetchVebraData(`/property/${propertyId}/files`);
        break;

      default:
        return res.status(400).json({ 
          error: 'Invalid endpoint',
          available: ['set-token', 'cache-status', 'test-credentials', 'branches', 'properties', 'property', 'property-files'],
          usage: {
            'set-token': '?endpoint=set-token&token=YOUR_TOKEN',
            'cache-status': '?endpoint=cache-status',
            'test-credentials': '?endpoint=test-credentials',
            'branches': '?endpoint=branches',
            'properties': '?endpoint=properties&branchId=1',
            'property': '?endpoint=property&propertyId=12345',
            'property-files': '?endpoint=property-files&propertyId=12345'
          }
        });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch data',
      message: error.message
    });
  }
}
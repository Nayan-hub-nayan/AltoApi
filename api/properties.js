// api/properties.js - Deploy this as a Vercel Serverless Function
// This middleware handles Vebra API authentication and returns JSON to Framer

const xml2js = require('xml2js');

// Your Vebra API credentials
// TRY BOTH SETS - You provided two different credentials
const VEBRA_CONFIG = {
  // OPTION 1: From email (current)
  username: 'PropLinkEst11UHxml',  
  password: 'y9y4Djx38r1Qaxa',     
  
  // OPTION 2: From first message (uncomment to try)
  // username: 'PLE35098',
  // password: 'X4h~srCfU5',
  
  datafeedId: 'PropertyLEAPI',      
  baseUrl: 'http://webservices.vebra.com/export/PropertyLEAPI/v10'
};

// Branch mapping - branchId to clientId
const BRANCH_MAP = {
  '1': '33273', // Lettings
  '2': '41620'  // Sales
};

// Token storage - persists across function calls in same instance
// Note: Vercel serverless functions may restart, losing this cache
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
    throw new Error('Token request failed recently. An active token may exist on the Vebra server. Please wait 5 minutes before retrying.');
  }

  console.log('Requesting new token...');
  console.log('Username:', VEBRA_CONFIG.username);
  console.log('Password length:', VEBRA_CONFIG.password.length);
  
  const url = `${VEBRA_CONFIG.baseUrl}/branch`;
  const credentials = Buffer.from(`${VEBRA_CONFIG.username}:${VEBRA_CONFIG.password}`).toString('base64');
  
  console.log('Auth string (base64):', credentials);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`
      }
    });

    console.log('Token response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    // If 401, there might be an active token already
    if (response.status === 401) {
      console.error('Authentication failed. Status:', response.status);
      console.error('This might mean there is already an active token on the Vebra server');
      
      // Store the error time to prevent rapid retries
      tokenCache.lastError = '401 Unauthorized';
      tokenCache.lastErrorTime = Date.now();
      
      throw new Error('Authentication failed - there may be an active token already. Vebra API only allows one token request per hour.');
    }

    // Get token from response headers (check multiple possible header names)
    const token = response.headers.get('token') || 
                  response.headers.get('Token') || 
                  response.headers.get('TOKEN') ||
                  response.headers.get('x-token') ||
                  response.headers.get('X-Token');
    
    if (token) {
      // Store token directly (it's already the token we need)
      tokenCache.token = token;
      tokenCache.expires = Date.now() + (55 * 60 * 1000); // 55 minutes
      tokenCache.lastError = null;
      tokenCache.lastErrorTime = null;
      console.log('Token received and cached:', token);
      console.log('Token expires at:', new Date(tokenCache.expires).toISOString());
      return tokenCache.token;
    }
    
    console.error('No token in any header. All headers:', Object.fromEntries(response.headers.entries()));
    throw new Error('No token received from API - authentication may have succeeded but no token was returned');
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
  console.log('Using token:', token);

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
    // Token expired, clear cache and retry once
    tokenCache.token = null;
    tokenCache.expires = null;
    
    // Retry once
    const newToken = await getToken();
    const newEncodedToken = Buffer.from(newToken + ':').toString('base64');
    
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
  
  // Convert XML to JSON
  const parser = new xml2js.Parser({ explicitArray: false });
  const jsonData = await parser.parseStringPromise(xmlData);
  
  return jsonData;
}

// Main handler
export default async function handler(req, res) {
  // Enable CORS for Framer
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { endpoint, branchId, propertyId } = req.query;

    console.log('Request:', { endpoint, branchId, propertyId });

    let data;

    switch (endpoint) {
      case 'test-all-credentials':
        // Test multiple credential combinations
        const credentialSets = [
          {
            name: 'Email credentials with PropertyLEAPI',
            username: 'PropLinkEst11UHxml',
            password: 'y9y4Djx38r1Qaxa',
            datafeedId: 'PropertyLEAPI',
            url: 'http://webservices.vebra.com/export/PropertyLEAPI/v10/branch'
          },
          {
            name: 'First message credentials with PLEQTAPI',
            username: 'PLE35098',
            password: 'X4h~srCfU5',
            datafeedId: 'PLEQTAPI',
            url: 'http://webservices.vebra.com/export/PLEQTAPI/v10/branch'
          },
          {
            name: 'Email credentials with PLEQTAPI',
            username: 'PropLinkEst11UHxml',
            password: 'y9y4Djx38r1Qaxa',
            datafeedId: 'PLEQTAPI',
            url: 'http://webservices.vebra.com/export/PLEQTAPI/v10/branch'
          }
        ];
        
        const results = [];
        
        for (const creds of credentialSets) {
          const testCreds = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
          
          try {
            const testResp = await fetch(creds.url, {
              method: 'GET',
              headers: {
                'Authorization': `Basic ${testCreds}`
              }
            });
            
            results.push({
              name: creds.name,
              status: testResp.status,
              hasToken: !!testResp.headers.get('token'),
              token: testResp.headers.get('token')?.substring(0, 20) + '...',
              url: creds.url
            });
          } catch (error) {
            results.push({
              name: creds.name,
              error: error.message
            });
          }
        }
        
        return res.status(200).json({ results });

      case 'test-credentials':
        // Test endpoint to verify credentials
        const testUrl = `${VEBRA_CONFIG.baseUrl}/branch`;
        const testCreds = Buffer.from(`${VEBRA_CONFIG.username}:${VEBRA_CONFIG.password}`).toString('base64');
        
        console.log('Testing credentials...');
        console.log('URL:', testUrl);
        console.log('Username:', VEBRA_CONFIG.username);
        
        const testResponse = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${testCreds}`
          }
        });
        
        const allHeaders = Object.fromEntries(testResponse.headers.entries());
        const hasToken = !!testResponse.headers.get('token');
        
        return res.status(200).json({
          status: testResponse.status,
          statusText: testResponse.statusText,
          hasToken: hasToken,
          token: hasToken ? testResponse.headers.get('token') : null,
          headers: allHeaders,
          credentials: {
            username: VEBRA_CONFIG.username,
            passwordLength: VEBRA_CONFIG.password.length,
            datafeedId: VEBRA_CONFIG.datafeedId
          }
        });

      case 'branches':
        // Get list of branches
        data = await fetchVebraData('/branch');
        break;

      case 'properties':
        // Get properties for a specific branch
        if (!branchId) {
          return res.status(400).json({ error: 'branchId required (1 for Lettings, 2 for Sales)' });
        }
        
        // Map branchId to clientId
        const clientId = BRANCH_MAP[branchId];
        if (!clientId) {
          return res.status(400).json({ error: 'Invalid branchId. Use 1 for Lettings or 2 for Sales' });
        }
        
        console.log(`Fetching properties for branch ${branchId} (client ${clientId})`);
        data = await fetchVebraData(`/branch/${clientId}/property`);
        break;

      case 'property':
        // Get single property details
        if (!propertyId) {
          return res.status(400).json({ error: 'propertyId required' });
        }
        data = await fetchVebraData(`/property/${propertyId}`);
        break;

      case 'property-files':
        // Get property files (images, floorplans, etc)
        if (!propertyId) {
          return res.status(400).json({ error: 'propertyId required' });
        }
        data = await fetchVebraData(`/property/${propertyId}/files`);
        break;

      default:
        return res.status(400).json({ 
          error: 'Invalid endpoint',
          available: ['branches', 'properties', 'property', 'property-files']
        });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch data',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
// api/properties.js - Deploy this as a Vercel Serverless Function
// This middleware handles Vebra API authentication and returns JSON to Framer

const xml2js = require('xml2js');

// Your Vebra API credentials
// IMPORTANT: Verify these match EXACTLY from your email
const VEBRA_CONFIG = {
  username: 'PropLinkEst11UHxml',  // From: USERNAME:  PropLinkEst11UHxml
  password: 'y9y4Djx38r1Qaxa',     // From: PASSWORD:  y9y4Djx38r1Qaxa
  datafeedId: 'PropertyLEAPI',      // From email - if wrong, try 'PLEQTAPI'
  baseUrl: 'http://webservices.vebra.com/export/PropertyLEAPI/v10'
};

// Branch mapping - branchId to clientId
const BRANCH_MAP = {
  '1': '33273', // Lettings
  '2': '41620'  // Sales
};

// Token storage (in production, use Redis or similar)
let tokenCache = {
  token: null,
  expires: null
};

// Function to get authentication token
async function getToken() {
  // Check if we have a valid cached token
  if (tokenCache.token && tokenCache.expires > Date.now()) {
    console.log('Using cached token');
    return tokenCache.token;
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

    // If 401, credentials are wrong
    if (response.status === 401) {
      const body = await response.text();
      console.error('Authentication failed. Response body:', body);
      throw new Error('Authentication failed - please check username and password');
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
      console.log('Token received and cached:', token);
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
        
        return res.status(200).json({
          status: testResponse.status,
          statusText: testResponse.statusText,
          headers: Object.fromEntries(testResponse.headers.entries()),
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
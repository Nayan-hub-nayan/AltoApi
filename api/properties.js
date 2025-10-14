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

// Token storage (in production, use Redis or similar)
let tokenCache = {
  token: null,
  expires: null
};

// Function to get authentication token
async function getToken() {
  // Check if we have a valid cached token
  if (tokenCache.token && tokenCache.expires > Date.now()) {
    return tokenCache.token;
  }

  const url = `${VEBRA_CONFIG.baseUrl}/branch`;
  const credentials = Buffer.from(`${VEBRA_CONFIG.username}:${VEBRA_CONFIG.password}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`
      }
    });

    // Get token from response headers
    const token = response.headers.get('Token');
    
    if (token) {
      // Cache token (expires in 55 minutes to be safe)
      tokenCache.token = Buffer.from(token).toString('base64');
      tokenCache.expires = Date.now() + (55 * 60 * 1000);
      return tokenCache.token;
    }
    
    throw new Error('No token received');
  } catch (error) {
    console.error('Token error:', error);
    throw error;
  }
}

// Function to fetch data from Vebra API
async function fetchVebraData(endpoint) {
  const token = await getToken();
  const url = `${VEBRA_CONFIG.baseUrl}${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${token}`
    }
  });

  if (response.status === 401) {
    // Token expired, clear cache and retry
    tokenCache.token = null;
    tokenCache.expires = null;
    return fetchVebraData(endpoint);
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
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

    let data;

    switch (endpoint) {
      case 'branches':
        // Get list of branches
        data = await fetchVebraData('/branch');
        break;

      case 'properties':
        // Get properties for a specific branch
        if (!branchId) {
          return res.status(400).json({ error: 'branchId required' });
        }
        data = await fetchVebraData(`/branch/${branchId}/property`);
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
        return res.status(400).json({ error: 'Invalid endpoint' });
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
const API_URL = 'http://localhost:5000/api';

export async function sendMessage(message) {
  try {
    console.log('[→] Sending message to backend:', message);
    
    const response = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message
      })
    });

    console.log('[←] Response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('[✓] Response received:', data);
    return data;
  } catch (error) {
    console.error('[✗] Error sending message:', error.message);
    
    if (error.message.includes('Failed to fetch')) {
      console.error('[!] Backend server is not running!');
      console.error('[•] Please run: cd backend && python server.py');
      throw new Error('Backend server is not running. Please start the Python server.');
    }
    
    throw error;
  }
}

export async function checkBackendHealth() {
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    console.log('[●] Backend health:', data);
    return response.ok;
  } catch (error) {
    console.error('[✗] Backend not available:', error);
    return false;
  }
}

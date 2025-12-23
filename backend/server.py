from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv
import requests

# Load environment variables FIRST
load_dotenv()

app = Flask(__name__)

# Configure CORS for both local development and production
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5173')
CORS(app, origins=[
    "http://localhost:5173",
    "http://localhost:3000",
    FRONTEND_URL,
    "*"
])

print("\n[●] Starting MyGraph AI Backend Server")
print("=" * 50)

# Get API key from environment
GROQ_API_KEY = os.getenv('GROQ_API_KEY')

if GROQ_API_KEY:
    print(f"[✓] GROQ_API_KEY found: {GROQ_API_KEY[:20]}...")
else:
    print("[✗] GROQ_API_KEY not found!")
    print("Make sure .env file has: GROQ_API_KEY=your_key")

@app.route('/api/chat', methods=['POST', 'OPTIONS'])
def chat():
    if request.method == 'OPTIONS':
        return '', 204
    
    try:
        data = request.json
        user_message = data.get('message', '')
        
        if not user_message:
            return jsonify({'error': 'Message is required', 'success': False}), 400
        
        # Check if API key is set
        if not GROQ_API_KEY:
            return jsonify({
                'success': False,
                'error': 'GROQ_API_KEY not configured in .env file'
            }), 500
        
        # Use REST API directly (no SDK compatibility issues)
        try:
            print(f"[→] Sending message to Groq: {user_message[:50]}...")
            
            # Call Groq API via REST
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "user", "content": user_message}
                ],
                "temperature": 0.7,
                "max_tokens": 1024
            }
            
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            
            if response.status_code == 200:
                result = response.json()
                ai_response = result['choices'][0]['message']['content']
                print(f"[✓] Got response from Groq")
                
                return jsonify({
                    'success': True,
                    'message': ai_response,
                    'user_message': user_message
                })
            else:
                error_msg = response.text
                print(f"[✗] Groq API error: {error_msg}")
                return jsonify({
                    'success': False,
                    'error': f'Groq API Error: {error_msg}'
                }), 500
            
        except Exception as e:
            error_msg = str(e)
            print(f"[✗] Groq API error: {error_msg}")
            return jsonify({
                'success': False,
                'error': f'Groq API Error: {error_msg}'
            }), 500
    
    except Exception as e:
        print(f"[✗] Error in chat endpoint: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'Backend is running',
        'groq_api_configured': bool(GROQ_API_KEY),
        'ai_service': 'Groq API'
    }), 200

@app.route('/', methods=['GET'])
def index():
    return jsonify({
        'message': 'MyGraph AI Backend Server',
        'version': '2.0',
        'ai_service': 'Groq API',
        'model': 'llama-3.3-70b-versatile',
        'status': 'running' if GROQ_API_KEY else 'API key missing'
    }), 200

if __name__ == '__main__':
    print("=" * 50)
    print("[•] Using Groq API (Free & Fast)")
    print("[•] Frontend on http://localhost:5173")
    print("[•] Backend on http://localhost:5000\n")
    app.run(debug=True, port=5000, host='0.0.0.0')

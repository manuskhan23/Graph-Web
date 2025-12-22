import os
import requests
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv('GROQ_API_KEY')

if not GROQ_API_KEY:
    print("❌ GROQ_API_KEY not found")
    exit()

print("🔍 Checking available Groq models...\n")

url = "https://api.groq.com/openai/v1/models"
headers = {
    "Authorization": f"Bearer {GROQ_API_KEY}"
}

try:
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        print(f"✅ Found {len(data['data'])} available models:\n")
        
        for model in data['data']:
            print(f"  - {model['id']}")
        
        print("\n💡 Use one of these model names in the server.py")
    else:
        print(f"❌ Error: {response.status_code}")
        print(response.text)
        
except Exception as e:
    print(f"❌ Error: {e}")

import google.generativeai as genai
from dotenv import load_dotenv
import os

load_dotenv()

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

if not GEMINI_API_KEY:
    print("❌ GEMINI_API_KEY not found in .env file")
    exit()

genai.configure(api_key=GEMINI_API_KEY)

print("🔍 Checking available Gemini models...\n")

try:
    models = genai.list_models()
    
    print("✅ Available models for generateContent:\n")
    for model in models:
        if 'generateContent' in model.supported_generation_methods:
            print(f"  - {model.name}")
    
except Exception as e:
    print(f"❌ Error listing models: {e}")
    print("\nMake sure your API key is valid!")

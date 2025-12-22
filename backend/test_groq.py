import os
from dotenv import load_dotenv

print("[*] Testing Groq Setup...\n")

# Load environment variables
load_dotenv()

# Check if .env file exists
if os.path.exists('.env'):
    print("[✓] .env file exists")
else:
    print("[✗] .env file NOT found")
    exit()

# Check API key
api_key = os.getenv('GROQ_API_KEY')
if api_key:
    print(f"[✓] GROQ_API_KEY found: {api_key[:20]}...")
else:
    print("[✗] GROQ_API_KEY not found in .env")
    exit()

# Set environment variable for Groq to use
os.environ['GROQ_API_KEY'] = api_key

# Try to import Groq
try:
    from groq import Groq
    print("[✓] Groq module imported successfully")
except ImportError as e:
    print(f"[✗] Error importing Groq: {e}")
    print("Run: pip install groq")
    exit()

# Try to initialize client WITHOUT passing api_key
try:
    print("[•] Initializing Groq client (reading from environment)...")
    client = Groq()  # No parameters - reads GROQ_API_KEY from environment
    print("[✓] Groq client initialized")
except Exception as e:
    print(f"[✗] Error initializing client: {e}")
    import traceback
    traceback.print_exc()
    exit()

# Try to make a test request
try:
    print("\n[→] Testing API with a simple message...")
    response = client.chat.completions.create(
        model="mixtral-8x7b-32768",
        messages=[
            {"role": "user", "content": "Hello, say hi back"}
        ],
        max_tokens=50,
    )
    print(f"[✓] API Response: {response.choices[0].message.content}")
    print("\n[✓] Everything works! You can use the AI chat now.")
except Exception as e:
    print(f"[✗] API Error: {e}")
    import traceback
    traceback.print_exc()
    exit()

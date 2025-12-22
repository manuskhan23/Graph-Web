# MyGraph AI Backend

## Setup Instructions

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Configure API Key
Make sure your `.env` file contains:
```
GEMINI_API_KEY=AIzaSyDguUn-cPJyFZH1OO0Ozi5iby-PonTe3LY
```

### 3. Run the Server
```bash
python server.py
```

The server will start on `http://localhost:5000`

### 4. Check if Backend is Working
Open your browser and go to:
- `http://localhost:5000` - Main page
- `http://localhost:5000/api/health` - Health check

### Troubleshooting

**Error: "Failed to fetch"**
- Make sure backend is running on port 5000
- Check if GEMINI_API_KEY is set correctly
- Make sure frontend is on port 5173

**Error: "Module not found"**
- Run `pip install -r requirements.txt` again
- Make sure you're in the `backend` folder

**Error: "API key is invalid"**
- Check if your GEMINI_API_KEY is correct in `.env`
- Get a new key from Google AI Studio: https://ai.google.dev

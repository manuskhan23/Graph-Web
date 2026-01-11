# MyGraph - Data Visualization & Graph Management Platform

A modern, feature-rich web application for creating, managing, and sharing data visualizations across multiple categories. Built with React, Firebase, and Chart.js with AI-powered assistance.

## 🎯 Features

### Core Features
- **User Authentication**: Secure sign-up and login with Firebase Authentication
- **Multiple Graph Types**: Business, Education, Sports, Health, Weather, and Web Analytics graphs
- **Create & Manage Graphs**: Easily create, edit, and delete custom graphs
- **Graph Sharing**: Generate shareable links for read-only access to graphs
- **Responsive Design**: Mobile-friendly UI with smooth animations

### Advanced Features
- **AI Assistant**: Chat-based AI assistant powered by Groq API for data insights
- **Scientific Calculator**: Built-in calculator for calculations and conversions
- **Survey System**: Create surveys and visualize survey responses with graphs
- **Admin Dashboard**: Comprehensive admin panel for managing users and survey responses
- **Multiple User Types**: Support for regular users and admin accounts
- **Data Persistence**: All graphs and chats are saved to Firebase in real-time

### UI/UX Enhancements
- **Smooth Animations**: Framer Motion animations for fluid user experience
- **Interactive Charts**: Chart.js integration for professional data visualization
- **Dark/Light Mode Compatible**: Clean, modern design
- **Real-time Chat**: AI-powered chat with markdown support

## 🛠️ Tech Stack

### Frontend
- **React 19.2**: UI library
- **React Router DOM 7.12**: Client-side routing
- **Framer Motion 12.23**: Animation library
- **Chart.js 4.5**: Data visualization
- **React-ChartJS-2 5.3**: React wrapper for Chart.js
- **React-Markdown 9.0**: Markdown rendering for AI responses
- **SweetAlert2 11.7**: Beautiful alerts and modals

### Backend & Database
- **Firebase 12.7**:
  - Authentication (Email/Password)
  - Realtime Database (RTDB)
  - Cloud Storage
- **Python Backend** (Optional AI enhancement):
  - Groq API for AI responses
  - FastAPI or Flask server

### Build & Development
- **Vite 7.2**: Fast build tool and dev server
- **ESLint 9.39**: Code linting
- **Node.js**: Runtime environment

## 📋 Prerequisites

- Node.js 16+ and npm
- Firebase account (free tier available)
- Groq API key (free tier available at https://console.groq.com)
- Python 3.8+ (for backend AI features)

## 🚀 Installation

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/graph-website.git
cd graph-website
```

### 2. Install Frontend Dependencies
```bash
npm install
```

### 3. Set Up Environment Variables
Create a `.env.local` file in the root directory:

```env
VITE_API_URL=http://localhost:5000/api
VITE_GROQ_API_KEY=your_groq_api_key_here
```

### 4. (Optional) Set Up Python Backend
```bash
cd backend
pip install -r requirements.txt
```

Create `.env` in backend folder:
```env
GROQ_API_KEY=your_groq_api_key_here
```

## 💻 Running the Application

### Development Mode

#### Frontend
```bash
npm run dev
```
The app will be available at `http://localhost:5173`

#### Backend (Optional AI feature)
```bash
cd backend
python server.py
```
Backend runs on `http://localhost:5000`

### Production Build
```bash
npm run build
npm run preview
```

## 📁 Project Structure

```
graph-website/
├── src/
│   ├── pages/                    # Page components
│   │   ├── Login.jsx            # Authentication
│   │   ├── Signup.jsx           # User registration
│   │   ├── Home.jsx             # Dashboard/home page
│   │   ├── AIChat.jsx           # AI chat interface
│   │   ├── ScientificCalculator.jsx
│   │   ├── SharedGraphView.jsx  # Public graph sharing
│   │   └── graphs/              # Graph type components
│   │       ├── BusinessGraph.jsx
│   │       ├── EducationGraph.jsx
│   │       ├── HealthGraph.jsx
│   │       ├── SportsGraph.jsx
│   │       ├── WeatherGraph.jsx
│   │       └── AnalyticsGraph.jsx
│   ├── components/               # Reusable components
│   │   ├── Navbar.jsx
│   │   ├── Footer.jsx
│   │   ├── Graph.jsx
│   │   ├── GraphRouter.jsx
│   │   ├── ShareModal.jsx
│   │   └── LoadingSpinner.jsx
│   ├── services/
│   │   └── aiService.js         # Groq AI API integration
│   ├── styles/                   # CSS files
│   ├── firebase.js               # Firebase configuration
│   ├── app.jsx                   # Main app routes
│   └── index.jsx                 # Entry point
├── survey/                       # Survey system
│   ├── form.jsx                 # Survey form component
│   ├── graph.jsx                # Survey visualization
│   ├── admin.jsx                # Admin dashboard
│   ├── adminManager.jsx         # Admin management
│   └── surveyFirebase.js        # Survey data handling
├── backend/                      # Python backend
│   ├── server.py                # FastAPI/Flask server
│   ├── requirements.txt
│   └── test_groq.py             # API testing
├── package.json
├── vite.config.js
└── index.html
```

## 🔑 Key Features Explained

### User Authentication
- Email/password based authentication via Firebase
- Automatic username generation
- Session persistence with localStorage

### Graph Management
- Create graphs in 6 different categories
- Real-time data storage in Firebase
- Edit and delete graphs
- Auto-save functionality

### AI Assistant
- Chat interface with conversation history
- Powered by Groq API (free, fast alternative to OpenAI)
- Markdown support for formatted responses
- Multiple chat conversations support

### Survey System
- Create custom surveys
- Collect responses from multiple users
- Visualize survey data with graphs
- Admin dashboard to view all responses

### Graph Sharing
- Generate unique shareable links
- Share graphs with non-users (no login required)
- Read-only access to shared graphs
- Public/Private graph settings

## 🔐 Security

- Firebase Authentication for secure user management
- Public/Private graph access control
- User data isolation (each user can only access their data)
- Admin role-based access control
- Environment variables for sensitive API keys

## 📝 Usage Examples

### Creating a Graph
1. Log in to your account
2. Go to Home page and select a category (e.g., Business, Education)
3. Click "Explore" or navigate to the category page
4. Fill in graph details and data
5. Click "Save Graph"

### Sharing a Graph
1. Navigate to your graph
2. Click "Share" button
3. Copy the generated link
4. Share with anyone (they don't need an account to view)

### Using AI Assistant
1. Navigate to "AI Assistant" from navigation menu
2. Start a new conversation or select an existing chat
3. Ask questions about data, analysis, or get insights
4. AI responses support markdown formatting

### Admin Features (if admin)
1. Access "Admin Dashboard" from navbar
2. View all survey responses
3. See unique survey participants
4. Manage other admins

## 🚀 Deployment

### Deploy to Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

### Deploy to Render.com (Backend)
```bash
# Create render.com account
# Connect your GitHub repo
# Set environment variables
# Deploy
```

### Deploy to Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

## 🐛 Troubleshooting

### Graph Links Not Working
- Ensure you're logged in for dashboard graphs
- Check if you're using correct baseUrl structure
- For shared graphs, ensure the share code is valid

### AI Chat Not Responding
- Verify Groq API key in `.env.local`
- Check internet connection
- Ensure backend is running (if using separate backend)

### Firebase Connection Issues
- Verify Firebase credentials in `firebase.js`
- Check if Realtime Database rules allow read/write
- Ensure database URL is correct

### Share Links Redirecting
- Share links with `?share=XXX` should work without login
- Non-authenticated users can view shared graphs
- Check if graph is set to public

## 📊 Database Schema

### Firebase Realtime Database
```
users/
  {uid}/
    username: string
    email: string
    displayName: string
    
graphs/
  {uid}/
    {graphId}/
      name: string
      type: string
      data: array
      labels: array
      isPublic: boolean
      createdAt: timestamp
      
sharedGraphs/
  {shareCode}/
    userId: string
    graphId: string
    graph: object
    isPublic: boolean
    createdAt: timestamp
    
chats/
  {uid}/
    {chatId}/
      name: string
      messages: array
      createdAt: timestamp
      updatedAt: timestamp
      
surveys/
  {surveyId}/
    responses: array
    respondents: array
```

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is open source and available under the MIT License. See LICENSE file for more details.

## 👨‍💻 Author

Created with ❤️ by [Your Name]

## 📞 Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Email: your-email@example.com
- Discord: [Your Discord Server Link]

## 🙏 Acknowledgments

- Firebase for authentication and database
- Groq for free AI API
- Chart.js for beautiful data visualizations
- Framer Motion for smooth animations
- React community for amazing libraries

## 📈 Future Enhancements

- [ ] Real-time collaboration on graphs
- [ ] Advanced data export (PDF, Excel)
- [ ] Custom chart types
- [ ] Data analytics and insights
- [ ] Team workspaces
- [ ] Mobile native app
- [ ] Dark mode toggle
- [ ] Email notifications
- [ ] Advanced filtering and search
- [ ] Graph templates

---

**Happy Graphing! 📊**

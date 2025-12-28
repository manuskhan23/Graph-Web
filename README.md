# 📊 Graph Website

<div align="center">

[![GitHub stars](https://img.shields.io/github/stars/manuskhan23/Graph-Web?style=for-the-badge&color=FFD700)](https://github.com/manuskhan23/Graph-Web/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/manuskhan23/Graph-Web?style=for-the-badge&color=4CAF50)](https://github.com/manuskhan23/Graph-Web/network)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react)](https://react.dev)
[![Firebase](https://img.shields.io/badge/Firebase-Realtime-FFCA28?style=for-the-badge&logo=firebase)](https://firebase.google.com)
[![Vite](https://img.shields.io/badge/Vite-7.2-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev)

**✨ Create stunning data visualizations with ease ✨**

*A comprehensive platform for building, managing, and analyzing beautiful graphs across 6 categories*

[🚀 Get Started](#-installation--setup) • [📖 Documentation](#-usage-guide) • [🐛 Report Bug](https://github.com/manuskhan23/Graph-Web/issues) • [💡 Request Feature](https://github.com/manuskhan23/Graph-Web/issues)

</div>

---

## 🎯 About

Graph Website is a modern, full-stack web application that empowers users to create professional data visualizations without any technical knowledge. Whether you're tracking business metrics, analyzing website traffic, monitoring health data, or comparing student performance—we've got you covered.

**Built with modern technologies and designed with user experience in mind.**

![Graph Website Hero](https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=400&fit=crop)

---

## ✨ Feature Highlights

### 🎨 Six Powerful Categories

<table>
  <tr>
    <td width="50%">
      <h4>💰 Business</h4>
      <p>Track revenue, expenses, profit & sales metrics</p>
    </td>
    <td width="50%">
      <h4>📈 Analytics</h4>
      <p>Monitor traffic, clicks, conversions & engagement</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h4>❤️ Health</h4>
      <p>Record weight, blood pressure, heart rate & steps</p>
    </td>
    <td width="50%">
      <h4>🌤️ Weather</h4>
      <p>Track temperature, rainfall, humidity & wind speed</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h4>⚽ Sports</h4>
      <p>Log team scores and match performance</p>
    </td>
    <td width="50%">
      <h4>🎓 Education</h4>
      <p>Compare student results across assessments</p>
    </td>
  </tr>
</table>

### 🔥 Core Features

| Feature | Benefit |
|---------|---------|
| 📊 **Multiple Chart Types** | Line, Bar & Pie charts for every visualization need |
| 🔐 **Secure Authentication** | Firebase-backed user authentication |
| 💾 **Real-time Database** | All data synced and backed up automatically |
| 👁️ **Live Preview** | See graphs before you save them |
| ✏️ **Easy Editing** | Modify graphs anytime with instant updates |
| 🚫 **Duplicate Detection** | Smart name validation prevents duplicates |
| 📱 **Responsive Design** | Works beautifully on desktop, tablet & mobile |
| ⚡ **Lightning Fast** | Built with Vite for instant HMR |
| 🤖 **AI Assistant** | Chat with AI powered by Groq API for instant help |
| 📋 **Survey System** | Create and manage surveys with admin dashboard |
| 📊 **Analytics Dashboard** | View insights based on unique students |
| 🧮 **Scientific Calculator** | Built-in advanced calculator |

---

## 🚀 Tech Stack

<div align="center">

| Frontend | Backend | Tools & APIs |
|----------|---------|-------|
| ![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react) | ![Firebase](https://img.shields.io/badge/Firebase-Realtime-FFCA28?logo=firebase) | ![Vite](https://img.shields.io/badge/Vite-7.2-646CFF?logo=vite) |
| ![Chart.js](https://img.shields.io/badge/Chart.js-4.5-FF6384) | ![Firestore](https://img.shields.io/badge/Firestore-Database-FFCA28?logo=firebase) | ![Groq API](https://img.shields.io/badge/Groq%20API-AI-4B32C3) |
| ![Framer Motion](https://img.shields.io/badge/Framer%20Motion-Animations-0055FF) | ![Realtime DB](https://img.shields.io/badge/Realtime_DB-Sync-FFCA28?logo=firebase) | ![Node.js](https://img.shields.io/badge/Node.js-16+-339933?logo=node.js) |

</div>

---

## 📦 Quick Start

### Prerequisites
- **Node.js** v16+ ([Download](https://nodejs.org/))
- **npm** or **yarn**
- **Firebase Account** ([Free Tier](https://firebase.google.com))

### Installation (5 minutes)

```bash
# 1️⃣ Clone the repository
git clone https://github.com/manuskhan23/Graph-Web.git
cd Graph-Web

# 2️⃣ Install dependencies
npm install

# 3️⃣ Configure Firebase
# Update src/firebase.js with your credentials from Firebase Console

# 4️⃣ Setup environment variables
# Create .env file in root directory:
VITE_GROQ_API_KEY=your_groq_api_key_here
VITE_API_URL=http://localhost:5000/api

# Get Groq API key from https://console.groq.com

# 5️⃣ Start the dev server
npm run dev
```

**That's it! 🎉 Visit `http://localhost:5173`**

---

## 💻 Usage Guide

### 📊 Creating Your First Graph

```
1. Sign up / Log in
2. Select a category (Business, Analytics, Health, etc.)
3. Click "Create New Graph"
4. Fill in the details:
   ✓ Graph name (must be unique in category)
   ✓ Select metric type
   ✓ Choose chart type (Line/Bar/Pie)
   ✓ Enter your data points
5. Preview your graph in real-time
6. Click Save
```

### 🤖 Using AI Assistant

```
1. Click "AI Assistant" button
2. Select or create a chat
3. Type your question or request
4. Get instant responses powered by Groq API
5. Chat history is automatically saved
```

### 📋 Creating Surveys

```
1. Navigate to Survey section
2. Click "Create New Survey"
3. Add survey questions
4. Share link with students
5. View responses in Admin Dashboard
6. Analyze insights by unique students
```

### 💡 Example: Business Revenue Report

```
📌 Report Name: Q1 Sales 2024
📈 Metric: Revenue
📊 Chart Type: Line Chart

Data Points:
  January → $50,000
  February → $65,000
  March → $72,000
```

### 🎮 Managing Your Graphs

| Action | Steps |
|--------|-------|
| 👁️ **View** | Click "Preview" on any graph card |
| ✏️ **Edit** | Click "Edit" and update your data |
| 🗑️ **Delete** | Click "Delete" (with confirmation) |
| 📊 **Create New** | Click "Create New Graph" button |

---

## 🔒 Key Features Deep Dive

### 🛡️ Duplicate Name Detection

Smart validation ensures you never accidentally create graphs with the same name:

```
⚠️ A graph with the name "Q1 Sales" already exists.
   Please choose a different name.
```

### 👁️ Real-time Preview

Visualize your data instantly before saving. Catch errors early and perfect your graphs.

### 🎨 Chart Type Guide

| Type | Best For | Example |
|------|----------|---------|
| **Line Chart** 📈 | Trends over time | Stock prices, temperature |
| **Bar Chart** 📊 | Comparing values | Sales by region, scores |
| **Pie Chart** 🥧 | Showing proportions | Market share, distribution |

---

## 🗂️ Project Structure

```
Graph-Website/
├── 📁 src/
│   ├── 📁 components/          # Reusable UI components
│   │   ├── Graph.jsx           # Chart renderer
│   │   ├── Navbar.jsx          # Navigation
│   │   └── Footer.jsx          # Footer
│   ├── 📁 pages/
│   │   ├── 📁 graphs/          # Category pages (6 types)
│   │   ├── Home.jsx            # Dashboard
│   │   ├── Login.jsx           # Auth page
│   │   ├── AIChat.jsx          # AI assistant
│   │   └── ScientificCalculator.jsx
│   ├── 📁 styles/              # Global CSS
│   ├── 📁 utils/               # Helper functions
│   ├── 📁 services/            # API services
│   ├── firebase.js             # Firebase config
│   └── App.jsx                 # Root component
├── 📁 survey/                  # Survey system
├── 📁 backend/                 # Backend (optional)
├── 📄 package.json
└── 📄 vite.config.js
 
```

---

## 🔧 Available Commands

```bash
# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Check code quality with ESLint
npm run lint
```

---

## 🚀 Deployment Guide

### ☁️ Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

### 🌐 Netlify

```bash
npm run build
# Upload the dist folder to Netlify
```

### 🎯 Render.com

```
1. Connect your GitHub repository
2. Build command: npm run build
3. Start command: npm run preview
4. Add environment variables
5. Deploy!
```

### 📦 Docker

```bash
docker build -t graph-website .
docker run -p 3000:3000 graph-website
```

---

## 🔐 Firebase Setup

### Step-by-Step Configuration

1. **Create Firebase Project**
   - Go to [firebase.google.com](https://firebase.google.com)
   - Click "Create a project"
   - Name your project

2. **Enable Authentication**
   - Go to Authentication → Sign-in method
   - Enable Email/Password

3. **Create Realtime Database**
   - Go to Realtime Database
   - Create database in test mode
   - Copy database URL

4. **Update Configuration**
   ```javascript
   // src/firebase.js
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_AUTH_DOMAIN",
     databaseURL: "YOUR_DATABASE_URL",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_STORAGE_BUCKET",
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

---

## 📊 Database Schema

```json
{
  "graphs": {
    "userId": {
      "category": {
        "graphId": {
          "id": "1234567890",
          "name": "Q1 Sales Report",
          "type": "line|bar|pie",
          "metric": "revenue",
          "labels": ["Jan", "Feb", "Mar"],
          "data": [50000, 65000, 72000],
          "createdAt": 1704067200000
        }
      }
    }
  },
  "users": {
    "userId": {
      "email": "user@example.com",
      "name": "John Doe",
      "createdAt": 1704067200000
    }
  }
}
```

---

## 🎯 Features Roadmap

```
✅ Multi-category graphs
✅ Duplicate name detection
✅ Real-time preview
✅ User authentication
✅ AI Assistant Chat (Groq API)
✅ Survey System with Admin Dashboard
✅ Real-time Analytics
✅ Scientific Calculator

🔄 Coming Soon:
⬜ CSV/PDF export
⬜ Graph sharing & collaboration
⬜ Advanced analytics
⬜ Custom themes
⬜ Dark mode
⬜ Mobile app
⬜ Collaborative editing
⬜ Email notifications
⬜ Advanced data filtering
```

---

## 🐛 Troubleshooting

### Firebase Connection Failed

```bash
# ✓ Check Firebase config in src/firebase.js
# ✓ Verify Realtime Database rules allow read/write
# ✓ Ensure API keys are valid and not restricted
```

### Graphs Not Loading

```bash
# ✓ Check browser console (F12)
# ✓ Verify user is authenticated
# ✓ Clear cache: Ctrl+Shift+Delete
```

### AI Chat: Invalid API Key Error

```bash
# ✓ Ensure VITE_GROQ_API_KEY is set in .env file
# ✓ Get key from https://console.groq.com
# ✓ Restart dev server after setting .env
```

### Build Issues

```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf dist .vite
npm run build
```

---

## 🤝 Contributing

We ❤️ contributions! Here's how to help:

1. **Fork** the repository
2. **Create** a feature branch
   ```bash
   git checkout -b feature/AmazingFeature
   ```
3. **Commit** your changes
   ```bash
   git commit -m '✨ Add AmazingFeature'
   ```
4. **Push** to the branch
   ```bash
   git push origin feature/AmazingFeature
   ```
5. **Open** a Pull Request

### Development Guidelines

- Follow the existing code style
- Add comments for complex logic
- Test thoroughly before submitting
- Update documentation as needed

---

## 📸 Screenshots

<div align="center">

| Dashboard | Graph Creation |
|-----------|-----------------|
| ![Dashboard](https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop) | ![Create](https://images.unsplash.com/photo-1642132652919-6c79e9166058?w=400&h=300&fit=crop) |
| **Visualization** | **Analytics** |
| ![Viz](https://images.unsplash.com/photo-1635631066127-14c3ba3c5dcd?w=400&h=300&fit=crop) | ![Analytics](https://images.unsplash.com/photo-1551062407-5dff1bc29973?w=400&h=300&fit=crop) |

</div>

---

## 📞 Support & Contact

| Channel | Link |
|---------|------|
| 🐛 **Report Bug** | [GitHub Issues](https://github.com/manuskhan23/Graph-Web/issues) |
| 💡 **Request Feature** | [GitHub Discussions](https://github.com/manuskhan23/Graph-Web/discussions) |
| 💬 **Ask Question** | [GitHub Discussions](https://github.com/manuskhan23/Graph-Web/discussions) |
| 📧 **Email** | muhammadanuskhan23@gmail.com |

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files...
```

---

## 🙏 Acknowledgments

<div align="center">

**Thank you to these amazing projects & communities:**

- [Chart.js](https://www.chartjs.org/) - Beautiful charts
- [Firebase](https://firebase.google.com/) - Backend infrastructure
- [React](https://react.dev/) - UI library
- [Vite](https://vitejs.dev/) - Build tool
- [Unsplash](https://unsplash.com/) - Stock images

</div>

---

## 👨‍💻 Author

<div align="center">

**M.Anus Khan**

[![GitHub](https://img.shields.io/badge/GitHub-@manuskhan23-181717?logo=github&style=for-the-badge)](https://github.com/manuskhan23)
[![Email](https://img.shields.io/badge/Email-muhammadanuskhan23%40gmail.com-D14836?logo=gmail&style=for-the-badge)](mailto:muhammadanuskhan23@gmail.com)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-M.Anus%20Khan-0077B5?logo=linkedin&style=for-the-badge)](https://linkedin.com/in/manuskhan23)

</div>

---

## ⭐ Show Your Support

If you found this project helpful, please consider:
- ⭐ Starring the repository
- 🐦 Sharing on social media
- 💬 Leaving feedback
- 🤝 Contributing

<div align="center">

### Made with ❤️ by M.Anus Khan

[⬆ Back to top](#-graph-website)

</div>

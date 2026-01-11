import React from 'react';
import '../styles/legal-pages.css';

function AboutUs({ onBack }) {
  return (
    <div className="legal-page-container">
      <button className="back-btn" onClick={onBack}>← Back to Home</button>
      
      <div className="legal-content">
        <h1>About Us</h1>

        <section>
          <h2>Who We Are</h2>
          <p>
            MyGraph is a modern data visualization platform dedicated to making it easy for everyone 
            to create, manage, and share beautiful, interactive graphs. Founded in 2023, our mission 
            is to democratize data analytics and make data visualization accessible to everyone.
          </p>
        </section>

        <section>
          <h2>Our Vision</h2>
          <p>
            We believe that data tells stories, and those stories should be easy to tell. Whether you're 
            a student tracking grades, a business monitoring financial metrics, a healthcare professional 
            tracking patient data, or a sports enthusiast analyzing game statistics, MyGraph provides the 
            tools you need to transform raw data into meaningful visualizations.
          </p>
        </section>

        <section>
          <h2>Our Core Values</h2>
          <ul>
            <li><strong>Simplicity:</strong> Our platform is intuitive and user-friendly</li>
            <li><strong>Accessibility:</strong> Data visualization should be available to everyone</li>
            <li><strong>Privacy:</strong> Your data is yours, and we protect it fiercely</li>
            <li><strong>Innovation:</strong> We constantly improve and add new features</li>
            <li><strong>Reliability:</strong> You can trust MyGraph to be there when you need it</li>
          </ul>
        </section>

        <section>
          <h2>Our Features</h2>
          <p>MyGraph offers comprehensive graph creation tools across multiple categories:</p>
          <ul>
            <li><strong>Business Graphs:</strong> Track financial metrics, revenue, expenses, and sales</li>
            <li><strong>Education Graphs:</strong> Monitor student performance and exam results</li>
            <li><strong>Sports Graphs:</strong> Analyze team performance and match statistics</li>
            <li><strong>Health Graphs:</strong> Track health metrics and wellness data</li>
            <li><strong>Weather Graphs:</strong> Visualize weather patterns and climate data</li>
            <li><strong>Analytics Graphs:</strong> Monitor website traffic and user engagement</li>
            <li><strong>AI Assistant:</strong> Get intelligent insights from your data</li>
          </ul>
        </section>

        <section>
          <h2>Why Choose MyGraph?</h2>
          <ul>
            <li>Easy-to-use interface requiring no technical skills</li>
            <li>Multiple chart types (bar, line, pie charts)</li>
            <li>Secure data storage with advanced encryption</li>
            <li>Share graphs with public or private links</li>
            <li>AI-powered insights and recommendations</li>
            <li>Scientific calculator for data analysis</li>
            <li>Responsive design works on all devices</li>
            <li>24/7 customer support</li>
          </ul>
        </section>

        <section>
          <h2>Our Team</h2>
          <p>
            MyGraph is built by a passionate team of developers, designers, and data enthusiasts 
            dedicated to making data visualization simple and beautiful. We're constantly working 
            to improve our platform and add new features based on user feedback.
          </p>
        </section>

        <section>
          <h2>Get In Touch</h2>
          <p>
            Have questions about MyGraph? We'd love to hear from you! Reach out to our team:
          </p>
          <p>
            Email: hello@mygraph.com<br />
            Address: 123 Graph Street, Data City, DC 12345<br />
            Phone: 1-800-MY-GRAPH
          </p>
        </section>
      </div>
    </div>
  );
}

export default AboutUs;

import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';

function Footer() {
  const currentYear = new Date().getFullYear();
  const navigate = useNavigate();
  const { username, adminname } = useParams();
  const baseUrl = username ? `/user/${username}` : adminname ? `/admin/${adminname}` : '/';

  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-section">
          <h4>MyGraph</h4>
          <p>Create beautiful and interactive graphs for your data</p>
        </div>

        <div className="footer-section">
          <h4>Categories</h4>
          <ul>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/business/new-graph`)}
              >
                Business Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/education/new-graph`)}
              >
                Education Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/sports/new-graph`)}
              >
                Sports Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/health/new-graph`)}
              >
                Health Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/weather/new-graph`)}
              >
                Weather Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/analytics/new-graph`)}
              >
                Analytics Graphs
              </button>
            </li>
          </ul>
        </div>

        <div className="footer-section">
          <h4>Tools</h4>
          <ul>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/ai-assistant/default`)}
              >
                AI Assistant
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/calculator`)}
              >
                Scientific Calculator
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/survey-form`)}
              >
                Survey Form
              </button>
            </li>
          </ul>
        </div>

        <div className="footer-section">
          <h4>Legal</h4>
          <ul>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/news/privacy-policy`)}
              >
                Privacy Policy
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/news/terms-conditions`)}
              >
                Terms & Conditions
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/news/about-us`)}
              >
                About Us
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => navigate(`${baseUrl}/contact`)}
              >
                Contact Us
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; {currentYear} MyGraph. All rights reserved.</p>
        <p>Made with ❤️ for data enthusiasts</p>
      </div>
    </footer>
  );
}

export default Footer;

import React from 'react';

function Footer() {
  const currentYear = new Date().getFullYear();

  const handleCategoryClick = (category) => {
    window.dispatchEvent(new CustomEvent('navigateToCategory', { detail: category }));
  };

  const handleAIClick = () => {
    window.dispatchEvent(new CustomEvent('navigateToAI'));
  };

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
                onClick={() => handleCategoryClick('business')}
              >
                Business Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => handleCategoryClick('education')}
              >
                Education Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => handleCategoryClick('sports')}
              >
                Sports Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => handleCategoryClick('health')}
              >
                Health Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => handleCategoryClick('weather')}
              >
                Weather Graphs
              </button>
            </li>
            <li>
              <button 
                className="footer-link" 
                onClick={() => handleCategoryClick('analytics')}
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
                onClick={handleAIClick}
              >
                AI Assistant
              </button>
            </li>
            <li><a href="#about">About Us</a></li>
            <li><a href="#privacy">Privacy Policy</a></li>
            <li><a href="#terms">Terms & Conditions</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </div>

        <div className="footer-section">
          <h4>Connect</h4>
          <div className="social-links">
            <a href="#facebook" className="social-btn" title="Facebook">f</a>
            <a href="#twitter" className="social-btn" title="Twitter">𝕏</a>
            <a href="#linkedin" className="social-btn" title="LinkedIn">in</a>
            <a href="#instagram" className="social-btn" title="Instagram">ig</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; {currentYear} MyGraph. All rights reserved.</p>
        <p>Made with care by Your Team</p>
      </div>
    </footer>
  );
}

export default Footer;

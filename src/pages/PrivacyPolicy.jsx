import React from 'react';
import '../styles/legal-pages.css';

function PrivacyPolicy({ onBack }) {
  return (
    <div className="legal-page-container">
      <button className="back-btn" onClick={onBack}>← Back to Home</button>
      
      <div className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="last-updated">Last Updated: January 2026</p>

        <section>
          <h2>1. Introduction</h2>
          <p>
            MyGraph ("we," "us," "our," or "Company") is committed to protecting your privacy. 
            This Privacy Policy explains how we collect, use, disclose, and safeguard your information 
            when you visit our website and use our services.
          </p>
        </section>

        <section>
          <h2>2. Information We Collect</h2>
          <p>We may collect information about you in a variety of ways. The information we may collect on the site includes:</p>
          <ul>
            <li><strong>Personal Data:</strong> Name, email address, and other information you voluntarily provide</li>
            <li><strong>Device Information:</strong> Browser type, IP address, and operating system</li>
            <li><strong>Usage Data:</strong> Pages visited, time spent on pages, and actions taken</li>
            <li><strong>Graph Data:</strong> Content you create, including graphs, labels, and datasets</li>
          </ul>
        </section>

        <section>
          <h2>3. Use of Your Information</h2>
          <p>Having accurate information about you permits us to provide you with a smooth, efficient, and customized experience. Specifically, we may use information collected about you via the site to:</p>
          <ul>
            <li>Create and manage your account</li>
            <li>Email you regarding your account or order</li>
            <li>Fulfill and send you related information and invoices</li>
            <li>Generate a personal profile about you</li>
            <li>Increase the efficiency and operation of the site</li>
            <li>Monitor and analyze usage and trends to improve your experience</li>
            <li>Notify you of updates to the site</li>
            <li>Offer new products, services, and/or recommendations to you</li>
          </ul>
        </section>

        <section>
          <h2>4. Disclosure of Your Information</h2>
          <p>We may share information we have collected about you in certain situations:</p>
          <ul>
            <li><strong>By Law or to Protect Rights:</strong> If required by law or if we believe in good faith that disclosure is necessary</li>
            <li><strong>Third-Party Service Providers:</strong> We may share your information with parties who assist us in operating our website</li>
            <li><strong>Business Transfers:</strong> Your information may be transferred as part of a merger, acquisition, or sale of assets</li>
          </ul>
        </section>

        <section>
          <h2>5. Security of Your Information</h2>
          <p>
            We use administrative, technical, and physical security measures to protect your personal information. 
            However, no method of transmission over the Internet is 100% secure. We strive to use commercially 
            acceptable means to protect your personal information, but we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2>6. Contact Us</h2>
          <p>
            If you have questions or comments about this Privacy Policy, please contact us at:
          </p>
          <p>
            Email: privacy@mygraph.com<br />
            Address: 123 Graph Street, Data City, DC 12345
          </p>
        </section>
      </div>
    </div>
  );
}

export default PrivacyPolicy;

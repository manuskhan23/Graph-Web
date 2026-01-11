import React from 'react';
import '../styles/legal-pages.css';

function TermsAndConditions({ onBack }) {
  return (
    <div className="legal-page-container">
      <button className="back-btn" onClick={onBack}>← Back to Home</button>
      
      <div className="legal-content">
        <h1>Terms and Conditions</h1>
        <p className="last-updated">Last Updated: January 2026</p>

        <section>
          <h2>1. Agreement to Terms</h2>
          <p>
            By accessing and using this website, you accept and agree to be bound by the terms and 
            provision of this agreement. If you do not agree to abide by the above, please do not use this service.
          </p>
        </section>

        <section>
          <h2>2. Use License</h2>
          <p>
            Permission is granted to temporarily download one copy of the materials (information or software) 
            on MyGraph's website for personal, non-commercial transitory viewing only. This is the grant of a 
            license, not a transfer of title, and under this license you may not:
          </p>
          <ul>
            <li>Modify or copy the materials</li>
            <li>Use the materials for any commercial purpose or for any public display</li>
            <li>Attempt to decompile or reverse engineer any software contained on the website</li>
            <li>Remove any copyright or other proprietary notations from the materials</li>
            <li>Transfer the materials to another person or "mirror" the materials on any other server</li>
          </ul>
        </section>

        <section>
          <h2>3. Disclaimer</h2>
          <p>
            The materials on MyGraph's website are provided on an 'as is' basis. MyGraph makes no warranties, 
            expressed or implied, and hereby disclaims and negates all other warranties including, without 
            limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, 
            or non-infringement of intellectual property or other violation of rights.
          </p>
        </section>

        <section>
          <h2>4. Limitations</h2>
          <p>
            In no event shall MyGraph or its suppliers be liable for any damages (including, without limitation, 
            damages for loss of data or profit, or due to business interruption) arising out of the use or 
            inability to use the materials on MyGraph's website.
          </p>
        </section>

        <section>
          <h2>5. Accuracy of Materials</h2>
          <p>
            The materials appearing on MyGraph's website could include technical, typographical, or photographic 
            errors. MyGraph does not warrant that any of the materials on its website are accurate, complete, 
            or current. MyGraph may make changes to the materials contained on its website at any time without notice.
          </p>
        </section>

        <section>
          <h2>6. Links</h2>
          <p>
            MyGraph has not reviewed all of the sites linked to its website and is not responsible for the 
            contents of any such linked site. The inclusion of any link does not imply endorsement by MyGraph 
            of the site. Use of any such linked website is at the user's own risk.
          </p>
        </section>

        <section>
          <h2>7. Modifications</h2>
          <p>
            MyGraph may revise these terms of service for its website at any time without notice. By using this 
            website, you are agreeing to be bound by the then current version of these terms of service.
          </p>
        </section>

        <section>
          <h2>8. Governing Law</h2>
          <p>
            These terms and conditions are governed by and construed in accordance with the laws of the 
            United States, and you irrevocably submit to the exclusive jurisdiction of the courts in that location.
          </p>
        </section>

        <section>
          <h2>9. Contact Us</h2>
          <p>
            If you have any questions about these Terms and Conditions, please contact us at:
          </p>
          <p>
            Email: legal@mygraph.com<br />
            Address: 123 Graph Street, Data City, DC 12345
          </p>
        </section>
      </div>
    </div>
  );
}

export default TermsAndConditions;

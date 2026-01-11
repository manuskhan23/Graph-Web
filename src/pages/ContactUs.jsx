import React, { useState } from 'react';
import Swal from 'sweetalert2';
import { saveContactMessage } from '../firebase';
import '../styles/legal-pages.css';

function ContactUs({ onBack }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name || !formData.email || !formData.subject || !formData.message) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Please fill in all fields'
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Please enter a valid email address'
      });
      return;
    }

    setLoading(true);
    
    try {
      const messageId = await saveContactMessage(
        formData.name,
        formData.email,
        formData.subject,
        formData.message
      );

      Swal.fire({
        icon: 'success',
        title: 'Message Sent!',
        text: 'Thank you for contacting us. We will get back to you soon.',
        timer: 2000,
        showConfirmButton: false
      });
      
      setFormData({
        name: '',
        email: '',
        subject: '',
        message: ''
      });
    } catch (error) {
      console.error('Error sending message:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to send message. Please try again later.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="legal-page-container">
      <button className="back-btn" onClick={onBack}>← Back to Home</button>
      
      <div className="legal-content">
        <h1>Contact Us</h1>
        <p className="contact-intro">We'd love to hear from you! Get in touch with our team.</p>

        <div className="contact-wrapper">
          <div className="contact-info">
            <section>
              <h2>Get In Touch</h2>
              
              <div className="info-item">
                <h3>📍 Address</h3>
                <p>
                  123 Graph Street<br />
                  Data City, DC 12345<br />
                  United States
                </p>
              </div>

              <div className="info-item">
                <h3>📧 Email</h3>
                <p>
                  <a href="mailto:support@mygraph.com">support@mygraph.com</a><br />
                  <a href="mailto:hello@mygraph.com">hello@mygraph.com</a>
                </p>
              </div>

              <div className="info-item">
                <h3>📞 Phone</h3>
                <p>
                  +1 (800) MY-GRAPH<br />
                  +1 (800) 694-7427
                </p>
              </div>

              <div className="info-item">
                <h3>🕐 Business Hours</h3>
                <p>
                  Monday - Friday: 9:00 AM - 6:00 PM<br />
                  Saturday: 10:00 AM - 4:00 PM<br />
                  Sunday: Closed
                </p>
              </div>

              <div className="info-item">
                <h3>🌐 Follow Us</h3>
                <p>
                  <a href="#facebook">Facebook</a> | 
                  <a href="#twitter"> Twitter</a> | 
                  <a href="#linkedin"> LinkedIn</a> | 
                  <a href="#instagram"> Instagram</a>
                </p>
              </div>
            </section>
          </div>

          <div className="contact-form">
            <h2>Send us a Message</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="name">Name *</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Your full name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="your.email@example.com"
                />
              </div>

              <div className="form-group">
                <label htmlFor="subject">Subject *</label>
                <input
                  type="text"
                  id="subject"
                  name="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  placeholder="What is this about?"
                />
              </div>

              <div className="form-group">
                <label htmlFor="message">Message *</label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  placeholder="Your message here..."
                  rows="6"
                />
              </div>

              <button 
                type="submit" 
                className="submit-btn"
                disabled={loading}
              >
                {loading ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContactUs;

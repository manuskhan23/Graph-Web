import React, { useEffect, useState } from 'react';
import { ref, onValue, push, remove } from 'firebase/database';
import { surveyDatabase } from './surveyFirebase';
import './adminManager.css';

function AdminManager({ onBack }) {
  const [adminEmails, setAdminEmails] = useState([]);
  const [mainAdmin] = useState('anus2580@gmail.com');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    const adminsRef = ref(surveyDatabase, 'admins');

    const unsubscribe = onValue(adminsRef, (snapshot) => {
      const data = [];
      snapshot.forEach((childSnapshot) => {
        data.push({
          id: childSnapshot.key,
          ...childSnapshot.val()
        });
      });
      setAdminEmails(data);
      setLoading(false);
    }, (error) => {
      console.error('Error loading admins:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const validatePassword = (password) => {
    return password.length >= 6;
  };

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (!newEmail.trim()) {
      setMessage({ type: 'error', text: 'Email is required' });
      return;
    }

    if (!validateEmail(newEmail)) {
      setMessage({ type: 'error', text: 'Please enter a valid email' });
      return;
    }

    if (!newPassword.trim()) {
      setMessage({ type: 'error', text: 'Password is required' });
      return;
    }

    if (!validatePassword(newPassword)) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' });
      return;
    }

    // Check if email already exists
    if (adminEmails.some(admin => admin.email === newEmail)) {
      setMessage({ type: 'error', text: 'This email is already an admin' });
      return;
    }

    // Check if email is main admin
    if (newEmail === mainAdmin) {
      setMessage({ type: 'error', text: 'This email is already the main admin' });
      return;
    }

    try {
      setAddingAdmin(true);
      const adminsRef = ref(surveyDatabase, 'admins');
      
      await push(adminsRef, {
        email: newEmail.toLowerCase(),
        password: newPassword, // Note: In production, passwords should be hashed
        addedBy: mainAdmin,
        addedAt: new Date().toISOString()
      });

      setMessage({ 
        type: 'success', 
        text: `Admin added successfully! Email: ${newEmail}` 
      });
      setNewEmail('');
      setNewPassword('');
      setShowForm(false);
    } catch (error) {
      console.error('Error adding admin:', error);
      setMessage({ type: 'error', text: 'Failed to add admin. Please try again.' });
    } finally {
      setAddingAdmin(false);
    }
  };

  const handleDeleteAdmin = async (id, email) => {
    if (window.confirm(`Remove ${email} from admin list?`)) {
      try {
        setDeletingId(id);
        const adminRef = ref(surveyDatabase, `admins/${id}`);
        await remove(adminRef);
        setMessage({ 
          type: 'success', 
          text: `Admin removed successfully` 
        });
      } catch (error) {
        console.error('Error removing admin:', error);
        setMessage({ type: 'error', text: 'Failed to remove admin' });
      } finally {
        setDeletingId(null);
      }
    }
  };

  if (loading) {
    return (
      <div className="admin-mgr-loading">
        <h2>Loading admin management...</h2>
      </div>
    );
  }

  return (
    <div className="admin-mgr-container">
      <div className="admin-mgr-header">
        <h1>👥 Manage Admins</h1>
        <button className="btn-back" onClick={onBack}>← Back</button>
      </div>

      {message.text && (
        <div className={`message-alert ${message.type}`}>
          {message.type === 'success' ? '✓' : '✕'} {message.text}
        </div>
      )}

      <div className="admin-mgr-content">
        {/* Main Admin Section */}
        <div className="section-card">
          <h2>👑 Main Admin</h2>
          <div className="admin-item main">
            <div className="admin-info">
              <div className="admin-email">{mainAdmin}</div>
              <div className="admin-badge">Main Administrator</div>
            </div>
            <div className="admin-status">
              <span className="status-badge active">Active</span>
            </div>
          </div>
          <p className="section-desc">This is the primary admin account and cannot be removed.</p>
        </div>

        {/* Add New Admin Section */}
        <div className="section-card">
          <div className="section-header">
            <h2>➕ Add New Admin</h2>
            <button
              className="btn-toggle-form"
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? '✕ Cancel' : '+ Add Admin'}
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleAddAdmin} className="add-admin-form">
              <div className="form-group">
                <label htmlFor="email">Email Address *</label>
                <input
                  type="email"
                  id="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password *</label>
                <input
                  type="password"
                  id="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="form-input"
                />
              </div>

              <div className="form-info">
                <p>⚠️ <strong>Important:</strong> Share the email and password securely with the new admin.</p>
                <p>They will need these credentials to log in and access the admin panel.</p>
              </div>

              <button
                type="submit"
                className="btn-submit"
                disabled={addingAdmin || !newEmail || !newPassword}
              >
                {addingAdmin ? 'Adding Admin...' : 'Add Admin'}
              </button>
            </form>
          )}
        </div>

        {/* Additional Admins Section */}
        <div className="section-card">
          <h2>🔑 Additional Admins ({adminEmails.length})</h2>

          {adminEmails.length === 0 ? (
            <div className="no-admins">
              <p>No additional admins added yet</p>
            </div>
          ) : (
            <div className="admins-list">
              {adminEmails.map((admin) => (
                <div key={admin.id} className="admin-item">
                  <div className="admin-info">
                    <div className="admin-email">{admin.email}</div>
                    <div className="admin-meta">
                      <span className="admin-date">
                        Added: {new Date(admin.addedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn-remove"
                    onClick={() => handleDeleteAdmin(admin.id, admin.email)}
                    disabled={deletingId === admin.id}
                  >
                    {deletingId === admin.id ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Admin Permissions Info */}
        <div className="section-card info-card">
          <h2>📋 Admin Permissions</h2>
          <div className="permissions-list">
            <div className="permission-item">
              <span className="permission-icon">📊</span>
              <span className="permission-text">View survey responses and analytics</span>
            </div>
            <div className="permission-item">
              <span className="permission-icon">📈</span>
              <span className="permission-text">View survey charts (Pie, Bar, Line)</span>
            </div>
            <div className="permission-item">
              <span className="permission-icon">🔍</span>
              <span className="permission-text">Search and filter survey data</span>
            </div>
            <div className="permission-item">
              <span className="permission-icon">🗑️</span>
              <span className="permission-text">Delete survey responses</span>
            </div>
            <div className="permission-item">
              <span className="permission-icon">👥</span>
              <span className="permission-text">Access admin management (main admin only)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminManager;

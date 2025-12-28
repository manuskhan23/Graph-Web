import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ref, onValue, push, remove, update } from 'firebase/database';
import { surveyDatabase } from './surveyFirebase';
import { getCurrentUser } from '../src/firebase';
import './adminManager.css';

function AdminManager({ onBack }) {
  const [adminEmails, setAdminEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [currentUserRole, setCurrentUserRole] = useState(null);
  
  const mainAdminEmail = 'anus2580@gmail.com';
  const currentUser = getCurrentUser();

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
      
      // Determine current user's role
      if (currentUser) {
        const userEmail = currentUser.email.toLowerCase();
        if (userEmail === mainAdminEmail.toLowerCase()) {
          setCurrentUserRole('main');
        } else {
          const userAdmin = data.find(a => a.email.toLowerCase() === userEmail);
          setCurrentUserRole(userAdmin?.role || 'added');
        }
      }
      
      setLoading(false);
    }, (error) => {
      console.error('Error loading admins:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Only main and second admins can access this page
  if (currentUserRole !== 'main' && currentUserRole !== 'second') {
    return (
      <div className="admin-mgr-container">
        <div className="admin-mgr-header">
          <h1>Access Denied</h1>
          <button className="btn-back" onClick={onBack}>← Back</button>
        </div>
        <div className="section-card">
          <p style={{ textAlign: 'center', color: '#666', fontSize: '16px' }}>
            Only main and second main admins can manage other admins.
          </p>
        </div>
      </div>
    );
  }

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
    if (adminEmails.some(admin => admin.email.toLowerCase() === newEmail.toLowerCase())) {
      setMessage({ type: 'error', text: 'This email is already an admin' });
      return;
    }

    try {
      setAddingAdmin(true);
      const adminsRef = ref(surveyDatabase, 'admins');
      
      await push(adminsRef, {
        email: newEmail.toLowerCase(),
        password: newPassword,
        role: 'added',
        addedBy: currentUser.email,
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

  const handleDeleteAdmin = async (id, email, adminRole) => {
    // Second admins can only delete 'added' admins
    if (currentUserRole === 'second' && adminRole !== 'added') {
      setMessage({ type: 'error', text: 'You can only delete Added Admins' });
      return;
    }

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

  const handlePromoteToSecond = async (id, email) => {
    // Only main admin can promote
    if (currentUserRole !== 'main') {
      setMessage({ type: 'error', text: 'Only Main Admin can promote admins' });
      return;
    }

    try {
      const adminRef = ref(surveyDatabase, `admins/${id}`);
      await update(adminRef, { role: 'second' });
      setMessage({ 
        type: 'success', 
        text: `${email} promoted to Second Main Admin` 
      });
    } catch (error) {
      console.error('Error promoting admin:', error);
      setMessage({ type: 'error', text: 'Failed to promote admin' });
    }
  };

  const handleDemoteFromSecond = async (id, email) => {
    // Only main admin can demote
    if (currentUserRole !== 'main') {
      setMessage({ type: 'error', text: 'Only Main Admin can demote admins' });
      return;
    }

    try {
      const adminRef = ref(surveyDatabase, `admins/${id}`);
      await update(adminRef, { role: 'added' });
      setMessage({ 
        type: 'success', 
        text: `${email} demoted to Added Admin` 
      });
    } catch (error) {
      console.error('Error demoting admin:', error);
      setMessage({ type: 'error', text: 'Failed to demote admin' });
    }
  };

  if (loading) {
    return (
      <div className="admin-mgr-loading">
        <h2>Loading admin management...</h2>
      </div>
    );
  }

  const mainAdmins = adminEmails.filter(a => a.role === 'main' || a.email.toLowerCase() === mainAdminEmail.toLowerCase());
  const secondAdmins = adminEmails.filter(a => a.role === 'second');
  const addedAdmins = adminEmails.filter(a => a.role === 'added');

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
              <div className="admin-email">{mainAdminEmail}</div>
              <div className="admin-badge">Main Administrator</div>
            </div>
            <div className="admin-status">
              <span className="status-badge active">Active</span>
            </div>
          </div>
          <p className="section-desc">This is the primary admin account and has full control.</p>
        </div>

        {/* Second Main Admins Section */}
        {secondAdmins.length > 0 && (
          <div className="section-card">
            <h2>⭐ Second Main Admins ({secondAdmins.length})</h2>
            <div className="admins-list">
              {secondAdmins.map((admin) => (
                <div key={admin.id} className="admin-item">
                  <div className="admin-info">
                    <div className="admin-email">{admin.email}</div>
                    <div className="admin-meta">
                      <span className="admin-date">
                        Added: {new Date(admin.addedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="btn-demote"
                      onClick={() => handleDemoteFromSecond(admin.id, admin.email)}
                      title="Demote to Added Admin"
                      disabled={currentUserRole !== 'main'}
                    >
                      Demote
                    </button>
                    <button
                      className="btn-remove"
                      onClick={() => handleDeleteAdmin(admin.id, admin.email, admin.role)}
                      disabled={deletingId === admin.id}
                    >
                      {deletingId === admin.id ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Added Admins Section */}
        <div className="section-card">
          <h2>🔑 Added Admins ({addedAdmins.length})</h2>

          {addedAdmins.length === 0 ? (
            <div className="no-admins">
              <p>No added admins yet</p>
            </div>
          ) : (
            <div className="admins-list">
              {addedAdmins.map((admin) => (
                <div key={admin.id} className="admin-item">
                  <div className="admin-info">
                    <div className="admin-email">{admin.email}</div>
                    <div className="admin-meta">
                      <span className="admin-date">
                        Added: {new Date(admin.addedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="btn-promote"
                      onClick={() => handlePromoteToSecond(admin.id, admin.email)}
                      title="Promote to Second Main Admin"
                      disabled={currentUserRole !== 'main'}
                    >
                      Promote
                    </button>
                    <button
                      className="btn-remove"
                      onClick={() => handleDeleteAdmin(admin.id, admin.email, admin.role)}
                      disabled={deletingId === admin.id}
                    >
                      {deletingId === admin.id ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Admin Permissions Info */}
        <div className="section-card info-card">
          <h2>📋 Admin Hierarchy & Permissions</h2>
          <div className="hierarchy-info">
            <div className="hierarchy-level">
              <h4>👑 Main Admin</h4>
              <ul>
                <li>View all admins</li>
                <li>Add new admins</li>
                <li>Delete any admin</li>
                <li>Promote to Second Main Admin</li>
                <li>Demote from Second Main Admin</li>
                <li>Full access to survey data</li>
              </ul>
            </div>
            <div className="hierarchy-level">
              <h4>⭐ Second Main Admin</h4>
              <ul>
                <li>View all admins list</li>
                <li>Add new admins</li>
                <li>Delete only Added Admins (cannot delete Second Main or Main Admin)</li>
                <li>Cannot promote/demote admins</li>
                <li>Full access to survey data</li>
              </ul>
            </div>
            <div className="hierarchy-level">
              <h4>🔑 Added Admin</h4>
              <ul>
                <li>Cannot see admin list</li>
                <li>Can only see Main Admin info</li>
                <li>Cannot add or delete admins</li>
                <li>Cannot access Manage Admins</li>
                <li>Full access to survey data</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminManager;

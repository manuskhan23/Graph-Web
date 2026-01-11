import React, { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import { shareGraph, getGraphShareCodes, revokeShareCode } from '../firebase';

function ShareModal({ 
  isOpen, 
  onClose, 
  graphId, 
  graphType, 
  userId 
}) {
  const [shareCodes, setShareCodes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && graphId && userId) {
      loadShareCodes();
    }
  }, [isOpen, graphId, userId]);

  const loadShareCodes = async () => {
    setLoading(true);
    try {
      const codes = await getGraphShareCodes(userId, graphType, graphId);
      setShareCodes(codes);
    } catch (err) {
      console.error('Error fetching share codes:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to load share codes'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateShare = async (isPublic) => {
    try {
      const code = await shareGraph(userId, graphType, graphId, isPublic);
      setShareCodes([...shareCodes, {
        shareCode: code,
        isPublic: isPublic,
        createdAt: new Date().toISOString()
      }]);
      
      Swal.fire({
        icon: 'success',
        title: 'Share Link Created!',
        html: `
          <div style="text-align: left; margin: 15px 0;">
            <p><strong>Share Code:</strong></p>
            <code style="background: #f0f0f0; padding: 8px; border-radius: 4px; display: block; word-break: break-all;">${code}</code>
            <p style="margin-top: 10px;"><strong>Full Link:</strong></p>
            <code style="background: #f0f0f0; padding: 8px; border-radius: 4px; display: block; word-break: break-all;">${window.location.origin}/?share=${code}&type=${graphType}</code>
            <p style="margin-top: 10px; font-size: 12px;">
              ${isPublic ? '🌐 This graph is PUBLIC - anyone with the link can view it' : '🔒 This graph is PRIVATE - only shared links work'}
            </p>
          </div>
        `,
        confirmButtonText: 'Copy & Close'
      }).then(() => {
        navigator.clipboard.writeText(`${window.location.origin}/?share=${code}&type=${graphType}`);
      });
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Failed to create share link: ' + err.message
      });
    }
  };

  const handleRevokeShare = async (shareCode) => {
    const result = await Swal.fire({
      title: 'Revoke Share Link?',
      text: 'This share link will no longer work',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Yes, revoke it!'
    });

    if (result.isConfirmed) {
      try {
        await revokeShareCode(shareCode);
        setShareCodes(shareCodes.filter(s => s.shareCode !== shareCode));
        Swal.fire({
          icon: 'success',
          title: 'Revoked!',
          text: 'Share link has been revoked'
        });
      } catch (err) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Failed to revoke share link'
        });
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Share Graph</h2>
        
        <div className="share-buttons">
          <button 
            className="public-share-btn"
            onClick={() => handleCreateShare(true)}
          >
            🌐 Create Public Link
          </button>
          <p className="share-desc">Anyone with the link can view (read-only)</p>
        </div>

        <h3>Existing Share Links</h3>
        {loading ? (
          <p>Loading share codes...</p>
        ) : shareCodes.length === 0 ? (
          <p className="no-shares">No share links created yet</p>
        ) : (
          <div className="share-codes-list">
            {shareCodes.map((share) => (
              <div key={share.shareCode} className="share-code-item">
                <div className="share-code-info">
                  <span className={`visibility-badge ${share.isPublic ? 'public' : 'private'}`}>
                    {share.isPublic ? '🌐 PUBLIC' : '🔒 PRIVATE'}
                  </span>
                  <code>{share.shareCode.substring(0, 12)}...</code>
                  <small>{new Date(share.createdAt).toLocaleDateString()}</small>
                </div>
                <div className="share-code-actions">
                  <button 
                    className="copy-btn"
                    onClick={() => {
                      const url = `${window.location.origin}/?share=${share.shareCode}&type=${graphType}`;
                      navigator.clipboard.writeText(url);
                      Swal.fire({
                        icon: 'success',
                        title: 'Copied!',
                        text: 'Share link copied to clipboard',
                        timer: 1500,
                        showConfirmButton: false
                      });
                    }}
                  >
                    Copy Link
                  </button>
                  <button 
                    className="revoke-btn"
                    onClick={() => handleRevokeShare(share.shareCode)}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ShareModal;

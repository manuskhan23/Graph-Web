import React, { useState, useEffect } from 'react';
import Swal from 'sweetalert2';
import { createPrivateLink, getPrivateLinksForGraph, revokePrivateLink } from '../firebase';
import '../styles/shared-graph.css';

// Reusable "Private Edit Links" section.
// Drop into any share modal. Visitors with the link can edit graph DATA only.
function PrivateLinkSection({ graphId, graphType, userId }) {
  const [privateLinks, setPrivateLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [limitChoice, setLimitChoice] = useState('none'); // 'none' | '5' | '10' | '15' | 'custom'
  const [customLimit, setCustomLimit] = useState('');

  useEffect(() => {
    if (graphId && userId) {
      loadLinks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphId, userId]);

  const loadLinks = async () => {
    setLoading(true);
    try {
      const links = await getPrivateLinksForGraph(userId, graphType, graphId);
      setPrivateLinks(links);
    } catch (err) {
      console.error('Error fetching private links:', err);
    } finally {
      setLoading(false);
    }
  };

  const getEffectiveLimit = () => {
    if (limitChoice === 'custom') {
      const n = parseInt(customLimit, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return limitChoice === 'none' ? 'none' : parseInt(limitChoice, 10);
  };

  const effectiveLimit = getEffectiveLimit();
  const showHighLimitWarning =
    effectiveLimit !== null && effectiveLimit !== 'none' && effectiveLimit > 100;

  const handleCreate = async () => {
    if (effectiveLimit === null) {
      Swal.fire({ icon: 'warning', title: 'Invalid limit', text: 'Please enter a valid open limit (at least 1).' });
      return;
    }
    try {
      const code = await createPrivateLink(userId, graphType, graphId, effectiveLimit);
      const url = `${window.location.origin}/private/${code}`;
      await loadLinks();
      Swal.fire({
        icon: 'success',
        title: 'Private Link Created!',
        html: `
          <div style="text-align: left; margin: 15px 0;">
            <p><strong>Private link:</strong></p>
            <code style="background: #f0f0f0; padding: 8px; border-radius: 4px; display: block; word-break: break-all;">${url}</code>
            <p style="margin-top: 10px; font-size: 12px;">
              🔒 Anyone with this link can <strong>edit the graph data only</strong> — they cannot delete the graph or create links.
              ${effectiveLimit === 'none' ? ' <strong>No open limit.</strong>' : ` Opens allowed: <strong>${effectiveLimit}</strong>.`}
            </p>
          </div>
        `,
        confirmButtonText: 'Copy & Close'
      }).then(() => {
        navigator.clipboard.writeText(url);
      });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to create private link: ' + err.message });
    }
  };

  const handleRevoke = async (linkCode) => {
    const result = await Swal.fire({
      title: 'Revoke Private Link?',
      text: 'The link will be permanently deleted. It disappears from this list, and anyone opening it will see a "revoked or does not exist" message.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Yes, revoke it!'
    });
    if (result.isConfirmed) {
      try {
        await revokePrivateLink(linkCode);
        await loadLinks();
        Swal.fire({ icon: 'success', title: 'Revoked!', text: 'Private link deleted — it no longer works.' });
      } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to revoke private link' });
      }
    }
  };

  const statusOf = (link) => {
    if (link.openLimit === 'none') return { label: '🟢 ACTIVE • ∞ opens', cls: 'active' };
    const used = link.openCount || 0;
    if (used >= Number(link.openLimit)) return { label: `🔴 LIMIT REACHED (${used}/${link.openLimit})`, cls: 'closed' };
    return { label: `🟢 ACTIVE • ${used}/${link.openLimit} opens`, cls: 'active' };
  };

  return (
    <div className="private-link-section">
      <h3>🔐 Private Edit Links</h3>
      <p className="share-desc">Anyone with a private link can <strong>edit the graph data only</strong> — no deleting, no new links. Links with a limit allow <strong>one open per device every 30 minutes</strong> so one person can't drain the limit.</p>

      <div className="private-limit-picker">
        <label className="picker-label">Open limit:</label>
        <div className="limit-chips">
          {[
            { value: 'none', label: 'No limit' },
            { value: '5', label: '5' },
            { value: '10', label: '10' },
            { value: '15', label: '15' },
            { value: 'custom', label: 'Custom' }
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`limit-chip ${limitChoice === opt.value ? 'selected' : ''}`}
              onClick={() => setLimitChoice(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {limitChoice === 'custom' && (
          <input
            type="number"
            min="1"
            className="custom-limit-input"
            placeholder="Enter opens allowed"
            value={customLimit}
            onChange={(e) => setCustomLimit(e.target.value)}
          />
        )}
        {showHighLimitWarning && (
          <div className="limit-warning">
            ⚠️ Heads up: you chose more than 100 opens. The link will stay editable for many visitors — we'll continue, but consider a smaller limit or revoke it when done.
          </div>
        )}
        <button className="create-private-btn" onClick={handleCreate}>
          ➕ Create Private Link
        </button>
      </div>

      {loading ? (
        <p>Loading private links...</p>
      ) : privateLinks.length === 0 ? (
        <p className="no-shares">No private links created yet</p>
      ) : (
        <div className="share-codes-list">
          {privateLinks.map((link) => {
            const status = statusOf(link);
            return (
              <div key={link.linkCode} className="share-code-item">
                <div className="share-code-info">
                  <span className={`visibility-badge ${status.cls}`}>{status.label}</span>
                  <code>/private/{link.linkCode.substring(0, 12)}...</code>
                  <small>{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : ''}</small>
                </div>
                <div className="share-code-actions">
                  <button
                    className="copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/private/${link.linkCode}`);
                      Swal.fire({ icon: 'success', title: 'Copied!', text: 'Private link copied', timer: 1500, showConfirmButton: false });
                    }}
                  >
                    Copy Link
                  </button>
                  <button className="revoke-btn" onClick={() => handleRevoke(link.linkCode)}>
                    Revoke
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PrivateLinkSection;

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { sendMessage } from '../services/aiService';
import { createChat, getUserChats, getChat, saveMessageToChat, deleteChat, updateChatName } from '../firebase';
import '../styles/aichat.css';

function AIChat({ user, onBack }) {
  // Chat list and management
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatName, setNewChatName] = useState('');
  const [renamingChatId, setRenamingChatId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);

  // Messages
  const [messages, setMessages] = useState([
    { id: 1, text: 'Hello! I am your AI Assistant. How can I help you today?', sender: 'ai' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  // Load chats on mount
  useEffect(() => {
    if (user) {
      loadChats();
    }
  }, [user]);

  // Load all chats (optimized)
  const loadChats = async () => {
    try {
      setLoadingChats(true);
      const userChats = await getUserChats(user.uid);
      
      // Convert to array and sort by date
      const chatsArray = Object.entries(userChats || {}).map(([id, chat]) => ({
        id,
        ...chat
      })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      
      setChats(chatsArray);
      
      // Set first chat as current
      if (chatsArray.length > 0) {
        setCurrentChatId(chatsArray[0].id);
        loadChat(chatsArray[0].id);
      }
    } catch (err) {
      console.error('Error loading chats:', err);
      setError('Failed to load chats');
    } finally {
      setLoadingChats(false);
    }
  };

  // Load specific chat
  const loadChat = async (chatId) => {
    try {
      const chat = await getChat(user.uid, chatId);
      if (chat) {
        setCurrentChatId(chatId);
        if (chat.messages && chat.messages.length > 0) {
          setMessages(chat.messages);
        } else {
          setMessages([
            { id: 1, text: 'Start chatting with AI. Your messages will be saved.', sender: 'ai' }
          ]);
        }
      }
    } catch (err) {
      console.error('Error loading chat:', err);
      setError('Failed to load chat');
    }
  };

  // Create new chat
  const handleCreateNewChat = async () => {
    try {
      const chatName = newChatName.trim() || `Chat ${chats.length + 1}`;
      const chatId = await createChat(user.uid, chatName);
      
      setChats(prev => [{
        id: chatId,
        name: chatName,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, ...prev]);
      
      setCurrentChatId(chatId);
      setNewChatName('');
      setShowNewChat(false);
      setMessages([
        { id: 1, text: 'Start your conversation. Your messages will be saved automatically.', sender: 'ai' }
      ]);
    } catch (err) {
      setError('Failed to create chat');
    }
  };

  // Rename chat
  const handleRenameChat = async (chatId) => {
    try {
      if (renameValue.trim()) {
        await updateChatName(user.uid, chatId, renameValue);
        setChats(prev => prev.map(c => 
          c.id === chatId ? { ...c, name: renameValue } : c
        ));
        setRenamingChatId(null);
        setRenameValue('');
      }
    } catch (err) {
      setError('Failed to rename chat');
    }
  };

  // Delete chat
  const handleDeleteChat = async (chatId) => {
    if (window.confirm('Delete this chat?')) {
      try {
        await deleteChat(user.uid, chatId);
        setChats(prev => prev.filter(c => c.id !== chatId));
        
        if (currentChatId === chatId) {
          setCurrentChatId(null);
          setMessages([]);
        }
      } catch (err) {
        setError('Failed to delete chat');
      }
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (!input.trim()) {
      setError('Please enter a message');
      return;
    }

    if (!currentChatId) {
      setError('Please create or select a chat first');
      return;
    }

    const userMessage = {
      id: Date.now().toString(),
      text: input,
      sender: 'user'
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      // Save user message to DB
      await saveMessageToChat(user.uid, currentChatId, userMessage);

      // Get AI response
      const response = await sendMessage(input);

      if (response.success) {
        const aiMessage = {
          id: Date.now().toString(),
          text: response.message,
          sender: 'ai'
        };

        const finalMessages = [...updatedMessages, aiMessage];
        setMessages(finalMessages);

        // Save AI message to DB
        await saveMessageToChat(user.uid, currentChatId, aiMessage);
      } else {
        setError('Failed to get response');
        const errorMessage = {
          id: Date.now().toString(),
          text: 'Error: Unable to process your request',
          sender: 'ai'
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
      const errorMessage = {
        id: Date.now().toString(),
        text: 'Error: Connection failed',
        sender: 'ai'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Get current chat name
  const currentChat = currentChatId && chats.find(c => c.id === currentChatId);
  const currentChatName = currentChat ? currentChat.name : 'New Chat';

  return (
    <div className="aichat-full-container">
      {/* Sidebar */}
      <aside className="aichat-sidebar">
        <div className="sidebar-header">
          <h3>Chats</h3>
          <button className="new-chat-btn" onClick={() => setShowNewChat(!showNewChat)}>
            +
          </button>
        </div>

        {showNewChat && (
          <div className="new-chat-form">
            <input
              type="text"
              placeholder="Chat name..."
              value={newChatName}
              onChange={(e) => setNewChatName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateNewChat()}
            />
            <button onClick={handleCreateNewChat}>Create</button>
            <button onClick={() => setShowNewChat(false)}>Cancel</button>
          </div>
        )}

        <div className="chat-list">
          {loadingChats ? (
            <p className="loading">Loading...</p>
          ) : chats.length === 0 ? (
            <p className="no-chats">No chats</p>
          ) : (
            chats.map((chat) => (
              <div
                key={chat.id}
                className={`chat-item ${currentChatId === chat.id ? 'active' : ''}`}
              >
                {renamingChatId === chat.id ? (
                  <div className="rename-input">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleRenameChat(chat.id)}
                      autoFocus
                    />
                    <button onClick={() => handleRenameChat(chat.id)}>Save</button>
                  </div>
                ) : (
                  <>
                    <button
                      className="chat-name"
                      onClick={() => loadChat(chat.id)}
                      title={chat.name}
                    >
                      {chat.name}
                    </button>
                    <div className="chat-actions">
                      <button
                        className="action-btn rename"
                        onClick={() => {
                          setRenamingChatId(chat.id);
                          setRenameValue(chat.name);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="action-btn delete"
                        onClick={() => handleDeleteChat(chat.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <button className="back-btn sidebar" onClick={onBack}>
          ← Back
        </button>
      </aside>

      {/* Main chat area */}
      <div className="aichat-main">
        <div className="aichat-header">
          <h1>{currentChatName}</h1>
        </div>

        <div className="chat-messages">
          {messages.map(msg => (
            <div key={msg.id} className={`message ${msg.sender}`}>
              <div className={`message-content ${msg.sender}`}>
                {msg.sender === 'ai' ? (
                  <ReactMarkdown
                    components={{
                      p: ({node, ...props}) => <p style={{ marginBottom: '10px' }} {...props} />,
                      ul: ({node, ...props}) => <ul style={{ marginLeft: '20px', marginBottom: '10px' }} {...props} />,
                      ol: ({node, ...props}) => <ol style={{ marginLeft: '20px', marginBottom: '10px' }} {...props} />,
                      li: ({node, ...props}) => <li style={{ marginBottom: '5px' }} {...props} />,
                    }}
                  >
                    {msg.text}
                  </ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="message ai">
              <div className="message-content ai">
                <span className="typing-indicator">
                  <span></span><span></span><span></span>
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="chat-input-section">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask anything... (Shift+Enter for new line)"
            className="chat-input"
            disabled={loading || !currentChatId}
          />
          <button
            onClick={handleSendMessage}
            disabled={loading || !input.trim() || !currentChatId}
            className="send-btn"
          >
            {loading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIChat;

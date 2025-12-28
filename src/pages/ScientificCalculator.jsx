import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getCurrentUser } from '../firebase';
import {
  saveCalculatorHistory,
  getCalculatorHistory,
  deleteCalculatorHistoryEntry,
  clearAllCalculatorHistory
} from '../firebase';
import '../styles/calculator.css';

function ScientificCalculator({ onBack }) {
  const [display, setDisplay] = useState('0');
  const [memory, setMemory] = useState(0);
  const [history, setHistory] = useState([]);
  const [isScientific, setIsScientific] = useState(true);
  const [previousValue, setPreviousValue] = useState(null);
  const [operation, setOperation] = useState(null);
  const [newNumber, setNewNumber] = useState(true);
  const [angleMode, setAngleMode] = useState('deg'); // deg or rad
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const user = getCurrentUser();

  // Load history from Firebase on component mount
  useEffect(() => {
    const loadHistory = async () => {
      if (user && user.uid) {
        try {
          const dbHistory = await getCalculatorHistory(user.uid);
          // Convert DB history to display format
          const formattedHistory = dbHistory.map(item => item.entry);
          setHistory(formattedHistory);
        } catch (error) {
          console.error('Error loading history:', error);
        }
      }
      setLoading(false);
    };

    loadHistory();
  }, [user]);

  // Number button handler
  const handleNumber = (num) => {
    if (newNumber) {
      setDisplay(String(num));
      setNewNumber(false);
    } else {
      setDisplay(display === '0' ? String(num) : display + num);
    }
  };

  // Decimal point handler
  const handleDecimal = () => {
    if (newNumber) {
      setDisplay('0.');
      setNewNumber(true);
    } else if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  // Operation handler
  const handleOperation = (op) => {
    const currentValue = parseFloat(display);

    if (previousValue === null) {
      setPreviousValue(currentValue);
    } else if (operation) {
      const result = calculate(previousValue, currentValue, operation);
      setDisplay(String(result));
      setPreviousValue(result);
    }

    setOperation(op);
    setNewNumber(true);
  };

  // Calculate result
  const calculate = (prev, current, op) => {
    switch (op) {
      case '+':
        return prev + current;
      case '-':
        return prev - current;
      case '*':
        return prev * current;
      case '/':
        return current !== 0 ? prev / current : 0;
      case '%':
        return prev % current;
      case '^':
        return Math.pow(prev, current);
      default:
        return current;
    }
  };

  // Equals button
  const handleEquals = async () => {
    if (operation && previousValue !== null) {
      const currentValue = parseFloat(display);
      const result = calculate(previousValue, currentValue, operation);
      const expression = `${previousValue} ${operation} ${currentValue} = ${result}`;
      
      setDisplay(String(result));
      const newHistory = [...history, expression];
      setHistory(newHistory);
      setPreviousValue(null);
      setOperation(null);
      setNewNumber(true);

      // Save to Firebase
      if (user && user.uid) {
        setSyncing(true);
        try {
          await saveCalculatorHistory(user.uid, expression);
        } catch (error) {
          console.error('Error saving history to DB:', error);
        }
        setSyncing(false);
      }
    }
  };

  // Scientific functions
  const handleScientific = (func) => {
    const current = parseFloat(display);
    let result;

    const degToRad = (deg) => (deg * Math.PI) / 180;
    const radToDeg = (rad) => (rad * 180) / Math.PI;

    switch (func) {
      case 'sin':
        result = angleMode === 'deg' ? Math.sin(degToRad(current)) : Math.sin(current);
        break;
      case 'cos':
        result = angleMode === 'deg' ? Math.cos(degToRad(current)) : Math.cos(current);
        break;
      case 'tan':
        result = angleMode === 'deg' ? Math.tan(degToRad(current)) : Math.tan(current);
        break;
      case 'sin⁻¹':
        result = angleMode === 'deg' ? radToDeg(Math.asin(current)) : Math.asin(current);
        break;
      case 'cos⁻¹':
        result = angleMode === 'deg' ? radToDeg(Math.acos(current)) : Math.acos(current);
        break;
      case 'tan⁻¹':
        result = angleMode === 'deg' ? radToDeg(Math.atan(current)) : Math.atan(current);
        break;
      case 'log':
        result = Math.log10(current);
        break;
      case 'ln':
        result = Math.log(current);
        break;
      case 'sqrt':
        result = Math.sqrt(current);
        break;
      case '∛':
        result = Math.cbrt(current);
        break;
      case 'e^x':
        result = Math.exp(current);
        break;
      case '10^x':
        result = Math.pow(10, current);
        break;
      case '1/x':
        result = 1 / current;
        break;
      case 'x!':
        result = factorial(Math.floor(current));
        break;
      case 'π':
        result = Math.PI;
        break;
      case 'e':
        result = Math.E;
        break;
      default:
        result = current;
    }

    const entry = `${func}(${current}) = ${result}`;
    setDisplay(String(result.toFixed(10).replace(/\.?0+$/, '')));
    setNewNumber(true);
    const newHistory = [...history, entry];
    setHistory(newHistory);

    // Save to Firebase
    if (user && user.uid) {
      setSyncing(true);
      try {
        saveCalculatorHistory(user.uid, entry);
      } catch (error) {
        console.error('Error saving history to DB:', error);
      }
      setSyncing(false);
    }
  };

  // Factorial function
  const factorial = (n) => {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  };

  // Clear
  const handleClear = () => {
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setNewNumber(true);
  };

  // Clear entry
  const handleClearEntry = () => {
    setDisplay('0');
    setNewNumber(true);
  };

  // Backspace
  const handleBackspace = () => {
    if (display.length > 1) {
      setDisplay(display.slice(0, -1));
    } else {
      setDisplay('0');
      setNewNumber(true);
    }
  };

  // Toggle sign
  const handleToggleSign = () => {
    const value = parseFloat(display);
    setDisplay(String(value * -1));
  };

  // Memory functions
  const handleMemoryAdd = () => {
    setMemory(memory + parseFloat(display));
    setNewNumber(true);
  };

  const handleMemorySubtract = () => {
    setMemory(memory - parseFloat(display));
    setNewNumber(true);
  };

  const handleMemoryRecall = () => {
    setDisplay(String(memory));
    setNewNumber(true);
  };

  const handleMemoryClear = () => {
    setMemory(0);
  };

  // Clear history
  const handleClearHistory = async () => {
    setHistory([]);
    
    // Delete from Firebase
    if (user && user.uid) {
      setSyncing(true);
      try {
        await clearAllCalculatorHistory(user.uid);
      } catch (error) {
        console.error('Error clearing history from DB:', error);
      }
      setSyncing(false);
    }
  };

  // Delete single history entry
  const handleDeleteHistoryEntry = async (index) => {
    const newHistory = history.filter((_, i) => i !== index);
    setHistory(newHistory);

    // Note: We're storing by entry text, not individual IDs
    // So we just clear and reload from Firebase after deletion
    if (user && user.uid) {
      setSyncing(true);
      try {
        // Clear all and save remaining
        await clearAllCalculatorHistory(user.uid);
        // Save remaining entries
        for (const entry of newHistory) {
          await saveCalculatorHistory(user.uid, entry);
        }
      } catch (error) {
        console.error('Error deleting history entry:', error);
      }
      setSyncing(false);
    }
  };

  // Copy to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(display);
    alert('Copied to clipboard!');
  };

  if (loading) {
    return (
      <div className="calculator-container">
        <motion.div 
          style={{ textAlign: 'center', color: 'white', paddingTop: '50px' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '4px solid rgba(255,255,255,0.3)',
              borderTop: '4px solid white',
              margin: '0 auto 20px'
            }}
          />
          Loading calculator...
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div 
      className="calculator-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <motion.button 
        className="back-btn" 
        onClick={onBack}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        ← Back
      </motion.button>

      {syncing && (
        <motion.div 
          className="sync-indicator"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Syncing...
        </motion.div>
      )}

      <motion.div 
        className="calculator-wrapper"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
      >
        {/* Calculator Main */}
        <div className="calculator-main">
          <h2>Scientific Calculator</h2>

          {/* Display */}
          <div className="calculator-display-section">
            <div className="memory-indicator">
              {memory !== 0 && (
                <span className="memory-badge">M: {memory.toFixed(2)}</span>
              )}
            </div>
            <div className="display">
              <input type="text" value={display} readOnly className="display-input" />
              <button className="copy-btn" onClick={handleCopy} title="Copy to clipboard">
                Copy
              </button>
            </div>
            <div className="angle-mode">
              <button
                className={`mode-btn ${angleMode === 'deg' ? 'active' : ''}`}
                onClick={() => setAngleMode('deg')}
              >
                DEG
              </button>
              <button
                className={`mode-btn ${angleMode === 'rad' ? 'active' : ''}`}
                onClick={() => setAngleMode('rad')}
              >
                RAD
              </button>
            </div>
          </div>

          {/* Memory Buttons */}
          <div className="button-grid memory-buttons">
            <button onClick={handleMemoryClear} title="Memory Clear">
              MC
            </button>
            <button onClick={handleMemoryRecall} title="Memory Recall">
              MR
            </button>
            <button onClick={handleMemoryAdd} title="Memory Add">
              M+
            </button>
            <button onClick={handleMemorySubtract} title="Memory Subtract">
              M-
            </button>
          </div>

          {/* Scientific Functions */}
          {isScientific && (
            <div className="button-grid scientific-buttons">
              <button onClick={() => handleScientific('sin')}>sin</button>
              <button onClick={() => handleScientific('cos')}>cos</button>
              <button onClick={() => handleScientific('tan')}>tan</button>
              <button onClick={() => handleScientific('sin⁻¹')}>sin⁻¹</button>
              <button onClick={() => handleScientific('cos⁻¹')}>cos⁻¹</button>
              <button onClick={() => handleScientific('tan⁻¹')}>tan⁻¹</button>
              <button onClick={() => handleScientific('log')}>log</button>
              <button onClick={() => handleScientific('ln')}>ln</button>
              <button onClick={() => handleScientific('sqrt')}>√</button>
              <button onClick={() => handleScientific('∛')}>∛</button>
              <button onClick={() => handleScientific('e^x')}>e^x</button>
              <button onClick={() => handleScientific('10^x')}>10^x</button>
              <button onClick={() => handleScientific('1/x')}>1/x</button>
              <button onClick={() => handleScientific('x!')} className="factorial">
                x!
              </button>
              <button onClick={() => handleScientific('π')}>π</button>
              <button onClick={() => handleScientific('e')}>e</button>
            </div>
          )}

          {/* Main Calculator Grid */}
          <div className="button-grid main-buttons">
            <button onClick={handleClear} className="wide-btn red">
              C
            </button>
            <button onClick={handleClearEntry} className="wide-btn red">
              CE
            </button>
            <button onClick={handleBackspace} className="wide-btn orange">
              ⌫
            </button>
            <button onClick={() => handleOperation('/')} className="operator">
              ÷
            </button>

            <button onClick={() => handleNumber(7)}>7</button>
            <button onClick={() => handleNumber(8)}>8</button>
            <button onClick={() => handleNumber(9)}>9</button>
            <button onClick={() => handleOperation('*')} className="operator">
              ×
            </button>

            <button onClick={() => handleNumber(4)}>4</button>
            <button onClick={() => handleNumber(5)}>5</button>
            <button onClick={() => handleNumber(6)}>6</button>
            <button onClick={() => handleOperation('-')} className="operator">
              −
            </button>

            <button onClick={() => handleNumber(1)}>1</button>
            <button onClick={() => handleNumber(2)}>2</button>
            <button onClick={() => handleNumber(3)}>3</button>
            <button onClick={() => handleOperation('+')} className="operator">
              +
            </button>

            <button onClick={() => handleNumber(0)} className="zero-btn">
              0
            </button>
            <button onClick={handleDecimal}>.</button>
            <button onClick={handleToggleSign}>±</button>
            <button onClick={handleEquals} className="equals">
              =
            </button>

            <button onClick={() => handleOperation('%')} className="operator">
              %
            </button>
            <button onClick={() => handleOperation('^')} className="operator">
              x^y
            </button>
          </div>
        </div>

        {/* History Sidebar */}
        <div className="calculator-history">
          <div className="history-header">
            <h3>History</h3>
            <button style={{width:"60px", borderRadius:"0px"}} onClick={handleClearHistory} className="clear-history-btn" title="Clear history">
              Clear
            </button>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <p className="empty-history">No history yet</p>
            ) : (
              history.map((entry, index) => (
                <div key={index} className="history-item">
                  <span>{entry}</span>
                  <button
                    className="history-delete-btn"
                    onClick={() => handleDeleteHistoryEntry(index)}
                    title="Delete this entry"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ScientificCalculator;

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import './form.css';
import { showSuccessAlert, showErrorAlert } from '../src/utils/alerts';
import { submitSurvey } from './surveyFirebase';

function SurveyForm({ onComplete }) {
  const [formData, setFormData] = useState({
    name: '',
    fatherName: '',
    class: '',
    section: '',
    socialMedia: [], // Changed to array for checkboxes
    socialMediaOther: '',
    timeSpent: '',
    timestamp: new Date().toISOString()
  });

  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const handleTextInput = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
    setTouched(prev => ({
      ...prev,
      [name]: true
    }));
  };

  const handleSocialMedia = (e) => {
    const value = e.target.value;
    const isChecked = e.target.checked;
    
    setFormData(prev => {
      let newSocialMedia = [...prev.socialMedia];
      
      if (isChecked) {
        newSocialMedia.push(value);
      } else {
        newSocialMedia = newSocialMedia.filter(item => item !== value);
      }
      
      return {
        ...prev,
        socialMedia: newSocialMedia,
        socialMediaOther: newSocialMedia.includes('others') ? prev.socialMediaOther : ''
      };
    });
    
    if (errors.socialMedia) {
      setErrors(prev => ({
        ...prev,
        socialMedia: ''
      }));
    }
    setTouched(prev => ({
      ...prev,
      socialMedia: true
    }));
  };

  const handleTimeSpent = (e) => {
    const value = e.target.value;
    setFormData(prev => ({
      ...prev,
      timeSpent: value
    }));
    if (errors.timeSpent) {
      setErrors(prev => ({
        ...prev,
        timeSpent: ''
      }));
    }
    setTouched(prev => ({
      ...prev,
      timeSpent: true
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = 'Name is required';
    if (!formData.fatherName.trim()) newErrors.fatherName = "Father's name is required";
    if (!formData.class.trim()) newErrors.class = 'Class is required';
    if (!formData.section.trim()) newErrors.section = 'Section is required';
    if (formData.socialMedia.length === 0) newErrors.socialMedia = 'Select at least one social media platform';
    if (formData.socialMedia.includes('others') && !formData.socialMediaOther.trim()) {
      newErrors.socialMediaOther = 'Please specify';
    }
    if (!formData.timeSpent) newErrors.timeSpent = 'Select time spent';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isFormValid = () => {
    return formData.name.trim() &&
           formData.fatherName.trim() &&
           formData.class.trim() &&
           formData.section.trim() &&
           formData.socialMedia.length > 0 &&
           (formData.socialMedia.includes('others') ? formData.socialMediaOther.trim() : true) &&
           formData.timeSpent;
  };

  const resetForm = () => {
    setFormData({
      name: '',
      fatherName: '',
      class: '',
      section: '',
      socialMedia: [],
      socialMediaOther: '',
      timeSpent: '',
      timestamp: new Date().toISOString()
    });
    setErrors({});
    setTouched({});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      showErrorAlert('Validation Error', 'Please fill all required fields');
      return;
    }

    try {
      // Prepare data for storage
      const surveyData = {
        name: formData.name,
        fatherName: formData.fatherName,
        class: formData.class,
        section: formData.section,
        platforms: formData.socialMedia, // Array of selected platforms
        platformOther: formData.socialMediaOther,
        timeSpent: formData.timeSpent,
        timestamp: formData.timestamp
      };

      // Submit to survey database
      await submitSurvey(surveyData);

      showSuccessAlert('Success', 'Your survey has been submitted successfully!');
      
      // Reset form
      resetForm();
      
      // Call onComplete callback to proceed to login
      if (onComplete) {
        setTimeout(() => {
          onComplete();
        }, 1500);
      }
    } catch (error) {
      console.error('Error submitting survey:', error);
      showErrorAlert('Error', 'Failed to submit survey. Please try again.');
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.5 },
    },
  };

  return (
    <motion.div 
      className="survey-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div 
        className="survey-form-wrapper"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <motion.h1 
          className="survey-title"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          Student Social Media Survey
        </motion.h1>
        <motion.p 
          className="survey-subtitle"
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Please answer all questions
        </motion.p>

        <motion.form 
          onSubmit={handleSubmit} 
          className="survey-form"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Question 1: Name */}
          <div className="form-floating mb-3">
            <input
              type="text"
              className={`form-control ${errors.name && touched.name ? 'is-invalid' : ''}`}
              id="name"
              name="name"
              value={formData.name}
              onChange={handleTextInput}
              placeholder="Your full name"
            />
            <label htmlFor="name">What is your name? *</label>
            {errors.name && touched.name && <div className="invalid-feedback d-block">{errors.name}</div>}
          </div>

          {/* Question 2: Father Name */}
          <div className="form-floating mb-3">
            <input
              type="text"
              className={`form-control ${errors.fatherName && touched.fatherName ? 'is-invalid' : ''}`}
              id="fatherName"
              name="fatherName"
              value={formData.fatherName}
              onChange={handleTextInput}
              placeholder="Your father's name"
            />
            <label htmlFor="fatherName">What is your father's name? *</label>
            {errors.fatherName && touched.fatherName && <div className="invalid-feedback d-block">{errors.fatherName}</div>}
          </div>

          {/* Question 3: Class */}
          <div className="form-floating mb-3">
            <input
              type="text"
              className={`form-control ${errors.class && touched.class ? 'is-invalid' : ''}`}
              id="class"
              name="class"
              value={formData.class}
              onChange={handleTextInput}
              placeholder="e.g., 9th, 10th, 11th, 12th"
            />
            <label htmlFor="class">What is your class? *</label>
            {errors.class && touched.class && <div className="invalid-feedback d-block">{errors.class}</div>}
          </div>

          {/* Question 4: Section */}
          <div className="form-floating mb-3">
            <input
              type="text"
              className={`form-control ${errors.section && touched.section ? 'is-invalid' : ''}`}
              id="section"
              name="section"
              value={formData.section}
              onChange={handleTextInput}
              placeholder="e.g., A, B, C"
            />
            <label htmlFor="section">What is your section? *</label>
            {errors.section && touched.section && <div className="invalid-feedback d-block">{errors.section}</div>}
          </div>

          {/* Question 5: Social Media Platform - Checkboxes */}
          <div className="mb-4">
            <label className="form-label fw-bold">Which social media platforms do you use? * (Select all that apply)</label>
            <div className="checkbox-group">
              {[
                { id: 'youtube', value: 'youtube', label: 'YouTube' },
                { id: 'instagram', value: 'instagram', label: 'Instagram' },
                { id: 'facebook', value: 'facebook', label: 'Facebook' },
                { id: 'linkedin', value: 'linkedin', label: 'LinkedIn' },
                { id: 'tiktok', value: 'tiktok', label: 'TikTok' },
                { id: 'others', value: 'others', label: 'Others' }
              ].map(option => (
                <div key={option.id} className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={option.id}
                    name="socialMedia"
                    value={option.value}
                    checked={formData.socialMedia.includes(option.value)}
                    onChange={handleSocialMedia}
                  />
                  <label className="form-check-label" htmlFor={option.id}>
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
            {errors.socialMedia && touched.socialMedia && <div className="text-danger small mt-2">{errors.socialMedia}</div>}
          </div>

          {/* Conditional input for "others" */}
          {formData.socialMedia.includes('others') && (
            <div className="form-floating mb-3">
              <input
                type="text"
                className={`form-control ${errors.socialMediaOther && touched.socialMediaOther ? 'is-invalid' : ''}`}
                id="socialMediaOther"
                name="socialMediaOther"
                value={formData.socialMediaOther}
                onChange={handleTextInput}
                placeholder="Please specify"
              />
              <label htmlFor="socialMediaOther">Please specify *</label>
              {errors.socialMediaOther && touched.socialMediaOther && <div className="invalid-feedback d-block">{errors.socialMediaOther}</div>}
            </div>
          )}

          {/* Question 6: Time Spent - Radio Buttons */}
          <div className="mb-4">
            <label className="form-label fw-bold">How much time do you spend on social media daily? *</label>
            <div className="radio-group">
              {[
                { id: 'time1', value: '2hrs', label: '2 hours' },
                { id: 'time2', value: '4hrs', label: '4 hours' },
                { id: 'time3', value: '6hrs', label: '6 hours' },
                { id: 'time4', value: '8hrs', label: '8 hours' },
                { id: 'time5', value: '8plus', label: 'More than 8 hours' }
              ].map(option => (
                <div key={option.id} className="form-check">
                  <input
                    className="form-check-input"
                    type="radio"
                    id={option.id}
                    name="timeSpent"
                    value={option.value}
                    checked={formData.timeSpent === option.value}
                    onChange={handleTimeSpent}
                  />
                  <label className="form-check-label" htmlFor={option.id}>
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
            {errors.timeSpent && touched.timeSpent && <div className="text-danger small mt-2">{errors.timeSpent}</div>}
          </div>

          <motion.button 
            type="submit" 
            className="btn btn-primary btn-lg w-100 submit-btn"
            disabled={!isFormValid()}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            Submit Survey
          </motion.button>
        </motion.form>
      </motion.div>
    </motion.div>
  );
}

export default SurveyForm;

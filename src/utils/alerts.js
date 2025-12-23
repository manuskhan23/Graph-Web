import Swal from 'sweetalert2';

// Success Alert
export const showSuccessAlert = (title, message) => {
  return Swal.fire({
    icon: 'success',
    title: title,
    text: message,
    timer: 1500,
    showConfirmButton: false
  });
};

// Error Alert
export const showErrorAlert = (title, message) => {
  return Swal.fire({
    icon: 'error',
    title: title,
    text: message,
    confirmButtonColor: '#d33'
  });
};

// Confirm Delete Alert
export const showConfirmDeleteAlert = () => {
  return Swal.fire({
    title: 'Delete Graph?',
    text: 'This action cannot be undone',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#3085d6',
    confirmButtonText: 'Yes, delete it!',
    cancelButtonText: 'Cancel'
  });
};

// Info Alert
export const showInfoAlert = (title, message) => {
  return Swal.fire({
    icon: 'info',
    title: title,
    text: message,
    confirmButtonColor: '#3085d6'
  });
};

// Loading Alert
export const showLoadingAlert = (title, message) => {
  Swal.fire({
    title: title,
    text: message,
    icon: 'info',
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });
};

// Close Loading Alert
export const closeAlert = () => {
  Swal.close();
};

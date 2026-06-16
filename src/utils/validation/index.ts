export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): boolean => {
  // At least 1 uppercase letter, 1 lowercase letter, 1 number, 1 special character, and minimum 8 characters
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]).{8,}$/;
  return passwordRegex.test(password);
};
export const validateName = (name: string): boolean => {
  // Allow letters, hyphens, and apostrophes (no spaces to prevent broken formatting like "Will iam")
  const nameRegex = /^[A-Za-zÀ-ÿ-']+$/;
  return nameRegex.test(name.trim());
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): boolean => {
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]).{8,}$/;
  return passwordRegex.test(password);
};
export const validateName = (name: string): boolean => {
  const nameRegex = /^[A-Za-zÀ-ÿ-']+$/;
  return nameRegex.test(name.trim());
};

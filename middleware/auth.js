// Memastikan user sudah login
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
};

// Memastikan user memiliki salah satu role yang diizinkan
const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    
    if (allowedRoles.includes(req.session.user.role)) {
      return next();
    }
    
    // Jika tidak diizinkan, redirect ke dashboard utama dengan parameter error
    res.redirect('/dashboard?error=unauthorized');
  };
};

module.exports = {
  isAuthenticated,
  restrictTo
};

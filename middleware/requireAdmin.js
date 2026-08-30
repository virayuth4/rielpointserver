const ADMIN_USER_IDS = [6]
   
function requireAdmin(req, res, next) {
    const userId = req.user?.id;
    console.log("userId in require admin", userId)

    if (!userId || !ADMIN_USER_IDS.includes(userId)) {
        console.warn('Blocked non-admin access attempt:', userId);
        return res.status(403).json({ message: 'Forbidden: admin access required.' });
    }

    next();
}

module.exports = requireAdmin;
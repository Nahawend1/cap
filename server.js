// Import necessary modules
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer = require('multer');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// --- Configuration & Middleware ---

const DATA_DIR = path.join(__dirname, '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const CONFIG_FILE = path.join(__dirname, 'config.json'); // <-- NEW: Config file path
const SESSION_DIR = path.join(DATA_DIR, 'sessions');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const SALT_ROUNDS = 10;

// --- Configuration Variable ---
let config = { adminUsernames: [] }; // Default config

// --- Ensure persistent AND public upload directories exist ---
async function ensureDirs() { /* ... same as before ... */
    try { await fs.mkdir(DATA_DIR, { recursive: true }); await fs.mkdir(SESSION_DIR, { recursive: true }); await fs.mkdir(UPLOADS_DIR, { recursive: true }); console.log("Dirs ensured."); try { await fs.writeFile(path.join(UPLOADS_DIR, '.gitignore'), '*\n!.gitignore'); } catch(gitIgnoreError) { console.warn("Could not write .gitignore", gitIgnoreError); } } catch (error) { console.error("Error creating dirs:", error); }
}
// --- Helper Functions ---
async function readData(filePath, defaultValue = []) { // Generic reader with default
    try {
        try { await fs.access(filePath); } catch { console.log(`File ${path.basename(filePath)} not found, creating/using default.`); await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2)); return defaultValue; } // Write default if not found
        const data = await fs.readFile(filePath, 'utf8');
        return data ? JSON.parse(data) : defaultValue; // Parse or return default
    } catch (error) { console.error(`Read Error (${path.basename(filePath)}):`, error); return defaultValue; } // Return default on error
}
async function writeData(filePath, data) { /* ... same as before ... */
    try { await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8'); } catch (error) { console.error(`Write Error (${path.basename(filePath)}):`, error); }
}
const readUsers = () => readData(USERS_FILE, []);
const writeUsers = (users) => writeData(USERS_FILE, users);
const readPosts = () => readData(POSTS_FILE, []);
const writePosts = (posts) => writeData(POSTS_FILE, posts);

// --- NEW: Function to read config ---
async function loadConfig() {
    console.log("Loading configuration...");
    try {
        const configData = await readData(CONFIG_FILE, { adminUsernames: [] }); // Provide default
        // Basic validation (ensure adminUsernames is an array)
        if (!Array.isArray(configData.adminUsernames)) {
            console.warn("config.json: 'adminUsernames' is not an array. Using empty list.");
            config = { adminUsernames: [] };
        } else {
             // Convert admin usernames to lowercase for case-insensitive comparison
             config = {
                 adminUsernames: configData.adminUsernames.map(name => name.toLowerCase())
             };
             console.log("Configuration loaded. Admins:", config.adminUsernames.join(', ') || 'None');
        }

    } catch (error) {
        console.error("FATAL: Could not load config.json. Using default empty admin list.", error);
        config = { adminUsernames: [] }; // Use default on error
    }
}

// --- Middleware Setup ---

// Session config (keep as before)
app.use(session({ /* ... same as before ... */
    store: new FileStore({ path: SESSION_DIR, logFn: function(){} }), secret: process.env.SESSION_SECRET || 'backup-secret-key-please-change', resave: false, saveUninitialized: false, cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
// EJS setup (keep as before)
app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, 'views'));
// Middleware (keep as before)
app.use(express.urlencoded({ extended: true })); app.use(express.static(path.join(__dirname, 'public')));
// Multer config (keep as before)
const storage = multer.diskStorage({ destination: UPLOADS_DIR, filename: (req, file, cb) => { const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9); cb(null, uniqueSuffix + path.extname(file.originalname)); } });
const fileFilter = (req, file, cb) => { if (file.mimetype.startsWith('image/')) { cb(null, true); } else { cb(new Error('Only image files allowed!'), false); } };
const upload = multer({ storage: storage, fileFilter: fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
// User session middleware (keep as before)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    // *** NEW: Add isAdmin flag to locals for templates ***
    res.locals.isAdmin = !!(req.session.user && config.adminUsernames.includes(req.session.user.username.toLowerCase()));
    next();
});

// --- Login Check Middleware (keep as before) ---
function requireLogin(req, res, next) { if (!req.session.user) { return res.redirect('/login'); } next(); }


// --- Routes ---

// Basic Page Routes (keep as before)
app.get('/', (req, res) => res.render('index', { page: 'home' }));
app.get('/about', (req, res) => res.render('about', { page: 'about' }));
app.get('/timeline', (req, res) => res.render('timeline', { page: 'timeline' }));
app.get('/take-action', (req, res) => res.render('take_action', { page: 'take-action' }));

// --- Auth Routes ---

// GET /signup
app.get('/signup', (req, res) => { if (req.session.user) return res.redirect('/profile'); res.render('signup', { page: 'signup', error: null }); });

// POST /signup (Remove role assignment, remove role from session)
app.post('/signup', upload.single('profilePicture'), async (req, res) => {
    if (req.session.user) return res.redirect('/profile');
    const { username, email, password, firstName, lastName, city } = req.body;
    const profilePictureFilename = req.file ? req.file.filename : null;

    if (!username || !email || !password || password.length < 6) { /* ... validation ... */ if (req.file) { try { await fs.unlink(path.join(UPLOADS_DIR, req.file.filename)); } catch {} } return res.render('signup', { page: 'signup', error: 'Username, email, and password (min 6 chars) required.' }); }

    try {
        const users = await readUsers();
        const existingUser = users.find(user => user.username.toLowerCase() === username.trim().toLowerCase() || user.email.toLowerCase() === email.trim().toLowerCase());
        if (existingUser) { /* ... handle existing user ... */ if (req.file) { try { await fs.unlink(path.join(UPLOADS_DIR, req.file.filename)); } catch {} } return res.render('signup', { page: 'signup', error: 'Username or email already exists.' }); }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2),
            username: username.trim(), email: email.trim().toLowerCase(), passwordHash: hashedPassword,
            firstName: firstName?.trim() || '', lastName: lastName?.trim() || '', city: city?.trim() || '',
            profilePictureFilename: profilePictureFilename, registeredAt: new Date().toISOString()
            // *** REMOVED role field ***
        };

        users.push(newUser);
        await writeUsers(users);
        console.log('User registered:', newUser.username);

        // Log in the user (Session DOES NOT store role anymore)
        req.session.user = { id: newUser.id, username: newUser.username };
        res.redirect('/success');

    } catch (error) { /* ... error handling ... */ console.error("Signup Error:", error); if (req.file) { try { await fs.unlink(path.join(UPLOADS_DIR, req.file.filename)); } catch {} } res.render('signup', { page: 'signup', error: 'An internal error occurred.' }); }
});

// GET /login
app.get('/login', (req, res) => { if (req.session.user) return res.redirect('/profile'); res.render('login', { page: 'login', error: null }); });

// POST /login (Remove role from session)
app.post('/login', async (req, res) => {
    if (req.session.user) return res.redirect('/profile');
    const { usernameOrEmail, password } = req.body;
    if (!usernameOrEmail || !password) { return res.render('login', { page: 'login', error: 'Username/Email and password required.' }); }

    try {
        const users = await readUsers();
        const user = users.find(u => u.username.toLowerCase() === usernameOrEmail.trim().toLowerCase() || u.email.toLowerCase() === usernameOrEmail.trim().toLowerCase());

        if (user && await bcrypt.compare(password, user.passwordHash)) {
            // Session only stores id and username
            req.session.user = { id: user.id, username: user.username };
            console.log('User logged in:', user.username);
            res.redirect('/profile'); // Redirect to profile page
        } else {
            console.log('Login failed for:', usernameOrEmail);
            res.render('login', { page: 'login', error: 'Invalid credentials.' });
        }
    } catch (error) { console.error("Login Error:", error); res.render('login', { page: 'login', error: 'An internal error occurred.' }); }
});

// GET /logout (keep as before)
app.get('/logout', (req, res) => { req.session.destroy(err => { if (err) console.error("Logout error:", err); res.clearCookie('connect.sid'); console.log('User logged out'); res.redirect('/login'); }); });

// GET /profile (keep as before)
app.get('/profile', requireLogin, async (req, res) => { /* ... same profile logic ... */
    try { const users = await readUsers(); const currentUser = users.find(u => u.id === req.session.user.id); if (!currentUser) { req.session.destroy(); return res.redirect('/login'); } const { passwordHash, ...profileData } = currentUser; res.render('profile', { page: 'profile', profileData: profileData }); } catch(error) { console.error("Profile fetch error:", error); res.status(500).send("Error loading profile."); }
});

// --- Post Routes ---

// GET /posts - Display all posts & TRACK UNIQUE VIEWS
app.get('/posts', async (req, res) => {
    try {
        let posts = await readPosts(); // Use 'let' as we might modify it
        let postsWereUpdated = false; // Flag to check if we need to save

        // --- View Tracking Logic ---
        if (req.session.user && req.session.user.id) {
            const userId = req.session.user.id;
            console.log(`DEBUG: User ${userId} loading /posts. Checking views.`);

            posts.forEach(post => {
                // Initialize viewedBy if it doesn't exist (for older posts created before this change)
                if (!Array.isArray(post.viewedBy)) {
                    post.viewedBy = [];
                    console.log(`DEBUG: Initialized viewedBy for post ${post.id}`);
                    // postsWereUpdated = true; // Optionally mark update even for initialization
                }

                // If user is logged in and hasn't viewed this post yet, record the view
                if (!post.viewedBy.includes(userId)) {
                    post.viewedBy.push(userId);
                    postsWereUpdated = true; // Mark that data has changed
                    console.log(`DEBUG: Recorded view for user ${userId} on post ${post.id}. New count: ${post.viewedBy.length}`);
                }
            });

            // If any view counts were updated, write the changes back to the file
            if (postsWereUpdated) {
                console.log("DEBUG: Saving updated posts data due to new views...");
                await writePosts(posts);
                console.log("DEBUG: Posts data saved.");
            }
        }
        // --- End View Tracking Logic ---


        // Sort posts newest first (using potentially updated data)
        posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Render the page (isAdmin is added by middleware)
        res.render('posts', { page: 'posts', posts: posts });

    } catch (error) {
        console.error("Error fetching/updating views for posts:", error);
        // Attempt to render with potentially stale data on error or show error message
        try {
            const posts = await readPosts(); // Re-read on error? Simple approach
            posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            res.render('posts', { page: 'posts', posts: posts, error: "Could not update view counts." });
        } catch (readError) {
            console.error("Error re-reading posts after view update failure:", readError);
            res.status(500).send("Could not load posts.");
        }
    }
});


// GET /posts/new - Show form to create a new post (keep as before)
app.get('/posts/new', requireLogin, (req, res) => {
    res.render('new-post', { page: 'new-post', error: null });
});

// POST /posts - Create a new post (Initialize viewedBy instead of views)
app.post('/posts', requireLogin, async (req, res) => {
    const { title, message } = req.body;
    const authorId = req.session.user.id;
    const authorUsername = req.session.user.username;

    if (!title || !message || !title.trim() || !message.trim()) {
        return res.render('new-post', { page: 'new-post', error: 'Title and message cannot be empty.' });
    }

    try {
        const users = await readUsers();
        const author = users.find(u => u.id === authorId);
        let authorDetails = { firstName: '', lastName: '', profilePicFilename: null };
        if (author) {
            authorDetails.firstName = author.firstName || '';
            authorDetails.lastName = author.lastName || '';
            authorDetails.profilePicFilename = author.profilePictureFilename || null;
        } else { console.warn(`Could not find author details for ID: ${authorId}`); }

        const newPost = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2),
            title: title.trim(),
            message: message.trim(),
            authorId: authorId,
            authorUsername: authorUsername,
            authorFirstName: authorDetails.firstName,
            authorLastName: authorDetails.lastName,
            authorProfilePicFilename: authorDetails.profilePicFilename,
            timestamp: new Date().toISOString(),
            likes: [],
            viewedBy: [] // <-- CHANGED: Initialize viewedBy array instead of views count
        };

        const posts = await readPosts();
        posts.push(newPost);
        await writePosts(posts);

        console.log('New post created by:', authorUsername);
        res.redirect('/posts');

    } catch (error) {
        console.error("Error creating post:", error);
        res.render('new-post', { page: 'new-post', error: 'Failed to save post.' });
    }
});

// POST /posts/:postId/like
app.post('/posts/:postId/like', requireLogin, async (req, res) => { /* ... same logic ... */
     const postId = req.params.postId; const userId = req.session.user.id; if (!postId) return res.status(400).json({ success: false, message: 'Post ID missing.' }); try { let posts = await readPosts(); const postIndex = posts.findIndex(p => p.id === postId); if (postIndex === -1) return res.status(404).json({ success: false, message: 'Post not found.' }); const post = posts[postIndex]; const likeIndex = post.likes.indexOf(userId); let liked = false; if (likeIndex === -1) { post.likes.push(userId); liked = true; } else { post.likes.splice(likeIndex, 1); liked = false; } await writePosts(posts); console.log(`User ${userId} ${liked ? 'liked' : 'unliked'} post ${postId}`); res.json({ success: true, likesCount: post.likes.length, userLiked: liked }); } catch (error) { console.error(`Like Error post ${postId}:`, error); res.status(500).json({ success: false, message: 'Error updating like status.' }); }
});

// POST /posts/:postId/delete (Check against config.adminUsernames)
app.post('/posts/:postId/delete', requireLogin, async (req, res) => {
    const postIdToDelete = req.params.postId;
    const currentUserId = req.session.user.id;
    const currentUsernameLower = req.session.user.username.toLowerCase(); // For admin check

    if (!postIdToDelete) return res.status(400).send('Post ID missing.');

    try {
        let posts = await readPosts();
        const postIndex = posts.findIndex(p => p.id === postIdToDelete);
        if (postIndex === -1) return res.status(404).send('Post not found.');

        const postToDelete = posts[postIndex];

        // *** Check authorization: User must be author OR username must be in admin list ***
        const isAdminUser = config.adminUsernames.includes(currentUsernameLower);
        if (postToDelete.authorId !== currentUserId && !isAdminUser) {
            console.warn(`Unauthorized delete attempt on post ${postIdToDelete} by user ${currentUserId}`);
            return res.status(403).send('Forbidden: You can only delete your own posts.');
        }

        posts.splice(postIndex, 1); // Remove post
        await writePosts(posts); // Save changes

        console.log(`Post ${postIdToDelete} deleted by user ${currentUserId} (Admin: ${isAdminUser})`);
        res.redirect('/posts');

    } catch (error) {
        console.error(`Error deleting post ${postIdToDelete}:`, error);
        res.status(500).send("An error occurred while deleting the post.");
    }
});

// --- Other Routes ---

// POST /delete-account
app.post('/delete-account', requireLogin, async (req, res) => { /* ... same logic ... */
    const userIdToDelete = req.session.user.id; try { let users = await readUsers(); const userIndex = users.findIndex(u => u.id === userIdToDelete); if (userIndex === -1) { req.session.destroy(()=>{}); return res.redirect('/login'); } const userToDelete = users[userIndex]; const filenameToDelete = userToDelete.profilePictureFilename; if (filenameToDelete) { const filePath = path.join(UPLOADS_DIR, filenameToDelete); try { await fs.unlink(filePath); console.log("Deleted profile picture:", filePath); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') { console.error("Error deleting file:", filePath, unlinkError); } else { console.log("Pic file not found:", filePath); } } } users.splice(userIndex, 1); await writeUsers(users); console.log("Deleted user data for:", userToDelete.username); try { let posts = await readPosts(); const remainingPosts = posts.filter(post => post.authorId !== userIdToDelete); if (posts.length !== remainingPosts.length) { await writePosts(remainingPosts); console.log(`Deleted ${posts.length - remainingPosts.length} posts for user ${userToDelete.username}`); } } catch (postDeleteError) { console.error(`Error deleting posts for user ${userIdToDelete}:`, postDeleteError); } req.session.destroy(err => { if (err) console.error("Sess destroy err:", err); res.clearCookie('connect.sid'); res.redirect('/?deleted=true'); }); } catch (error) { console.error("Delete Acc Error:", error); res.status(500).send("Error deleting account."); }
});

// GET /users
app.get('/users', async (req, res) => {
    try { const users = await readUsers(); const userList = users.map(({ passwordHash, role, ...rest }) => rest); res.render('users', { page: 'users', userList: userList }); } // Removed role display
    catch (error) { console.error("User list error:", error); res.status(500).send('Could not retrieve user list.'); }
});

// GET /success
app.get('/success', (req, res) => res.render('success', { page: 'success' }));

// Search Route
app.get('/search', async (req, res) => { /* ... same logic ... */
    const searchQuery = (req.query.query || '').trim().toLowerCase(); let results = []; let error = null; if (searchQuery) { try { const users = await readUsers(); results = users.filter(user => (user.username?.toLowerCase().includes(searchQuery)) || (user.firstName?.toLowerCase().includes(searchQuery)) || (user.lastName?.toLowerCase().includes(searchQuery)) ).map(({ passwordHash, ...rest }) => rest); } catch (err) { console.error("Search Error:", err); error = "Error performing search."; results = []; } } res.render('search-results', { page: 'search', query: req.query.query, results: results, error: error });
});

// --- 404 Handler ---
app.use((req, res) => res.status(404).render('404', { page: '404' }));

ensureDirs()
    .then(loadConfig)
    .then(() => {
        const listener = app.listen(port, () => {
            console.log(`Your app is listening on port ${listener.address().port}`);
            console.log(`Admin usernames loaded: ${config.adminUsernames.join(', ') || 'None'}`);
        });
    })
    .catch(err => { console.error("Fatal error during startup:", err); process.exit(1); });
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getFirestore, collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc, onSnapshot, query, where, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInAnonymously,
    reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Your web app's Firebase configuration
import { firebaseConfig } from "./firebaseConfig.js";
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Global listeners for real-time data
let studentsUnsubscribe = null;
let facultiesUnsubscribe = null;
let administratorsUnsubscribe = null;
let studentsCache = [];
let facultiesCache = [];
let administratorsCache = [];
let initialAuthChecked = false; // Flag to handle initial load

document.addEventListener('DOMContentLoaded', () => {
    const menuItems = document.querySelectorAll('.menu-item');
    const contentBox = document.getElementById('content-display');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMessage = document.getElementById('loading-message');
    const logoutBtn = document.getElementById('logout-btn');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const mainLayout = document.querySelector('.main-layout');

    if (menuToggleBtn && mainLayout) {
        menuToggleBtn.addEventListener('click', () => {
            mainLayout.classList.toggle('sidebar-collapsed');
        });
    }

    let currentStream = null;
    let editingId = null; 
    let editingType = '';

    // --- Custom Modal Logic ---
    const customModal = document.getElementById('custom-modal');
    const modalMessage = document.getElementById('modal-message');
    const modalOkBtn = document.getElementById('modal-ok-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalPasswordInput = document.getElementById('modal-password');


    function showAlert(message) {
        return new Promise((resolve) => {
            modalMessage.textContent = message;
            modalPasswordInput.style.display = 'none';
            modalCancelBtn.style.display = 'none';
            modalOkBtn.style.display = 'inline-block';
            customModal.classList.add('visible');
            modalOkBtn.onclick = () => {
                customModal.classList.remove('visible');
                resolve(true);
            };
        });
    }

    function showConfirm(message) {
        return new Promise((resolve) => {
            modalMessage.textContent = message;
            modalPasswordInput.style.display = 'none';
            modalCancelBtn.style.display = 'inline-block';
            modalOkBtn.style.display = 'inline-block';
            customModal.classList.add('visible');
            modalOkBtn.onclick = () => {
                customModal.classList.remove('visible');
                resolve(true);
            };
            modalCancelBtn.onclick = () => {
                customModal.classList.remove('visible');
                resolve(false);
            };
        });
    }

    function showPasswordConfirm(message) {
        return new Promise((resolve) => {
            modalMessage.textContent = message;
            modalPasswordInput.value = '';
            modalPasswordInput.style.display = 'block';
            modalCancelBtn.style.display = 'inline-block';
            modalOkBtn.style.display = 'inline-block';
            customModal.classList.add('visible');
            
            modalOkBtn.onclick = () => {
                customModal.classList.remove('visible');
                modalPasswordInput.style.display = 'none';
                resolve(modalPasswordInput.value); // Resolve with the password
            };
            
            modalCancelBtn.onclick = () => {
                customModal.classList.remove('visible');
                modalPasswordInput.style.display = 'none';
                resolve(null); // Resolve with null if cancelled
            };
        });
    }

    // --- Face-API Model Loading ---
    async function loadFaceApiModels() {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
        try {
            loadingMessage.textContent = 'Loading Core Model...';
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
            loadingMessage.textContent = 'Loading Landmarks Model...';
            await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
            loadingMessage.textContent = 'Loading Recognition Model...';
            await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
            loadingOverlay.style.display = 'none';
        } catch (error) {
            loadingMessage.textContent = 'Failed to load models. Please refresh.';
            console.error('Model loading failed:', error);
        }
    }
    loadFaceApiModels();


    // --- Firestore Data Fetching ---
    function listenToStudents() {
        if (studentsUnsubscribe) studentsUnsubscribe();
        studentsUnsubscribe = onSnapshot(collection(db, "students"), (snapshot) => {
            studentsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('studentList')) renderStudents();
        });
    }

    function listenToFaculties() {
        if (facultiesUnsubscribe) facultiesUnsubscribe();
        facultiesUnsubscribe = onSnapshot(collection(db, "faculties"), (snapshot) => {
            facultiesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('facultyList')) renderFaculties();
        });
    }

    function listenToAdministrators() {
        if (administratorsUnsubscribe) administratorsUnsubscribe();
        administratorsUnsubscribe = onSnapshot(collection(db, "administrators"), (snapshot) => {
            administratorsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (document.getElementById('administratorList')) renderAdministrators();
        });
    }
    
    // --- ATTENDANCE PERCENTAGE CALCULATION ---
async function calculateAttendancePercentage(personId, type) {
    const collectionName = `${type}_attendance`;
    const q = collection(db, collectionName);
    try {
        const querySnapshot = await getDocs(q);
        // CHANGE 1: Total days is the total number of attendance documents (days class was held)
        const totalDays = querySnapshot.size;
        let presentDays = 0;

        if (totalDays === 0) {
            return 'N/A';
        }

        // CHANGE 2: The loop now only needs to count the days a student was present
        querySnapshot.forEach(doc => {
            const records = doc.data().records;
            if (records && records.hasOwnProperty(personId) && records[personId] === 'Present') {
                presentDays++;
            }
        });

        const percentage = (presentDays / totalDays) * 100;
        return `${percentage.toFixed(1)}%`;
    } catch (error) {
        console.error(`Error calculating attendance for ${personId}:`, error);
        return 'Error';
    }
}


    const mainContent = {
        'student-data': `
            <h3>Student Data</h3>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="add-student">Add New Student</button>
            </div>
            <div id="studentList" class="available-list"></div>`,
        'faculty-data': `
            <h3>Faculty Data</h3>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="add-faculty">Add New Faculty</button>
            </div>
            <div id="facultyList" class="available-list"></div>`,
        'administrator': `
            <h3>Administrator Data</h3>
            <div id="administratorList" class="available-list"></div>
            <hr>
            <h3>Administrator Attendance Dashboard</h3>
            <div class="attendance-options">
                <input type="date" id="administrator-attendance-date">
                <button id="view-administrator-attendance-btn">View Historical</button>
            </div>
             <h4>Mark Today's Attendance:</h4>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="mark-administrator-attendance-manual">Manually</button>
            </div>
            <div id="administrator-attendance-sheet-container" class="available-list"></div>`,
        'face-attendance': `
            <h3>Face Attendance</h3>
            <div class="attendance-type-selector">
                <label><input type="radio" name="attendanceType" value="student" checked> Student</label>
                <label><input type="radio" name="attendanceType" value="faculty"> Faculty</label>
                <label><input type="radio" name="attendanceType" value="administrator"> Administrator</label>
            </div>
            <div class="camera-container">
                 <video id="video-stream" width="400" height="300" autoplay muted></video>
                 <button id="capture-image" class="camera-button">Capture</button>
                 <canvas id="photo-canvas" width="400" height="300" style="display:none;"></canvas>
                 <div id="capture-message"></div>
            </div>`,
        'student-attendance': `
            <h3>Student Attendance Dashboard</h3>
            <div class="attendance-options">
                <input type="date" id="student-attendance-date">
                <button id="view-student-attendance-btn">View Historical</button>
            </div>
            <h4>Mark Today's Attendance:</h4>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="mark-student-attendance-manual">Manually</button>
            </div>
            <div id="student-attendance-sheet-container" class="available-list"></div>`,
        'faculty-attendance': `
            <h3>Faculty Attendance Dashboard</h3>
            <div class="attendance-options">
                <input type="date" id="faculty-attendance-date">
                <button id="view-faculty-attendance-btn">View Historical</button>
            </div>
             <h4>Mark Today's Attendance:</h4>
            <div class="sub-menu">
                <button class="sub-option" data-sub-content="mark-faculty-attendance-manual">Manually</button>
            </div>
            <div id="faculty-attendance-sheet-container" class="available-list"></div>`
    };

    const subContent = {
        'mark-student-attendance-manual': `
            <button class="form-button back-button" data-back-to="student-attendance">Back to Dashboard</button>
            <h3>Mark Student Attendance Manually for Today</h3>
            <div id="student-manual-attendance-sheet" class="available-list"></div>
            `,
        'mark-faculty-attendance-manual': `
            <button class="form-button back-button" data-back-to="faculty-attendance">Back to Dashboard</button>
            <h3>Mark Faculty Attendance Manually for Today</h3>
            <div id="faculty-manual-attendance-sheet" class="available-list"></div>
            `,
        'mark-administrator-attendance-manual': `
            <button class="form-button back-button" data-back-to="administrator">Back to Dashboard</button>
            <h3>Mark Administrator Attendance Manually for Today</h3>
            <div id="administrator-manual-attendance-sheet" class="available-list"></div>
            `,
        'add-student': `
            <button class="form-button back-button" data-back-to="student-data">Back</button>
            <h4>Add New Student</h4>
            <form class="form-container" id="add-student-form">
                <div class="form-grid">
                    <div class="form-fields">
                        <img id="studentImagePreview" class="form-image-preview" src="" alt="Image Preview">
                        <label for="studentName">Name:</label><input type="text" id="studentName" required>
                        <label for="studentCollegeId">College ID:</label><input type="text" id="studentCollegeId" required>
                        <label for="studentClass">Class:</label><input type="text" id="studentClass" required>
                        <label for="studentPhone">Phone Number:</label><input type="text" id="studentPhone">
                        <label for="parentPhone">Parents' Phone Number:</label><input type="text" id="parentPhone">
                    </div>
                    <div class="camera-section">
                        <div class="video-capture-wrapper">
                           <video id="student-video" autoplay muted></video>
                           <canvas id="student-canvas" width="400" height="300"></canvas>
                        </div>
                        <button type="button" class="camera-button" id="openCameraBtnStudent">Open Camera</button>
                    </div>
                </div>
                <button type="submit" class="form-button" id="saveStudentBtn" style="margin-top: 15px; width: 100%;">Save Student</button>
            </form>`,
        'add-faculty': `
            <button class="form-button back-button" data-back-to="faculty-data">Back</button>
            <h4>Add New Faculty</h4>
            <form class="form-container" id="add-faculty-form">
                <div class="form-grid">
                    <div class="form-fields">
                        <img id="facultyImagePreview" class="form-image-preview" src="" alt="Image Preview">
                        <label for="facultyName">Faculty Name:</label><input type="text" id="facultyName" required>
                        <label for="facultyDepartment">Department:</label><input type="text" id="facultyDepartment" required>
                        <label for="facultySubject">Subject:</label><input type="text" id="facultySubject" required>
                        <label for="facultyPhone">Phone Number:</label><input type="text" id="facultyPhone">
                    </div>
                    <div class="camera-section">
                        <div class="video-capture-wrapper">
                           <video id="faculty-video" autoplay muted></video>
                           <canvas id="faculty-canvas" width="400" height="300"></canvas>
                        </div>
                        <button type="button" class="camera-button" id="openCameraBtnFaculty">Open Camera</button>
                    </div>
                </div>
                <button type="submit" class="form-button" id="saveFacultyBtn" style="margin-top: 15px; width: 100%;">Save Faculty</button>
            </form>`,
    };

    function stopCamera(streamToStop) {
        if (streamToStop) {
            streamToStop.getTracks().forEach(track => track.stop());
            currentStream = null;
        }
    }
    
    function getFormattedDate(date) {
        return date.toISOString().split('T')[0];
    }
    
    // AUTHENTICATION LOGIC
    onAuthStateChanged(auth, user => {
        if (user && !user.isAnonymous) {
            // User is a logged-in administrator
            logoutBtn.style.display = 'block';
            listenToStudents();
            listenToFaculties();
            listenToAdministrators();
        } else {
            // User is anonymous or logged out
            logoutBtn.style.display = 'none';
            // Stop listening to data to save reads
            if (studentsUnsubscribe) studentsUnsubscribe();
            if (facultiesUnsubscribe) facultiesUnsubscribe();
            if (administratorsUnsubscribe) administratorsUnsubscribe();
            studentsCache = [];
            facultiesCache = [];
            administratorsCache = [];
        }

        // This block runs only ONCE on initial page load after auth state is confirmed
        if (!initialAuthChecked) {
            initialAuthChecked = true;
            const defaultContentId = 'face-attendance';
            // ALWAYS show the face attendance page on initial load, regardless of auth state.
            updateMainContent(defaultContentId);
            
            // Set the active menu item regardless
            document.querySelector(`.menu-item[data-content-id="${defaultContentId}"]`).classList.add('active');
        }
    });

    function renderLogin(targetContentId) {
        contentBox.innerHTML = `
            <h3>Administrator Login</h3>
            <form id="login-form" class="form-container">
                <label for="adminEmailLogin">Email:</label>
                <input type="email" id="adminEmailLogin" required>
                <label for="adminPasswordLogin">Password:</label>
                <input type="password" id="adminPasswordLogin" required>
                <button type="submit" class="form-button" style="width: 100%;">Login</button>
            </form>
            <div style="text-align: center; margin-top: 20px;">
                Don't have an account? <button id="go-to-signup">Sign Up</button>
            </div>
        `;
        document.getElementById('login-form').addEventListener('submit', (e) => {
            handleLogin(e, targetContentId);
        });
        document.getElementById('go-to-signup').addEventListener('click', () => {
            renderSignUp(targetContentId);
        });
    }

    function renderSignUp(targetContentId) {
        contentBox.innerHTML = `
            <button id="back-to-login" class="form-button back-button">Back to Login</button>
            <h4>Administrator Sign Up</h4>
            <form class="form-container" id="admin-signup-form">
                <div class="form-grid">
                    <div class="form-fields">
                        <img id="administratorImagePreview" class="form-image-preview" src="" alt="Image Preview">
                        <label for="administratorName">Name:</label><input type="text" id="administratorName" required>
                        <label for="administratorEmail">Email:</label><input type="email" id="administratorEmail" required>
                        <label for="administratorRole">Role (e.g., Principal):</label><input type="text" id="administratorRole" required>
                        <label for="administratorPhone">Phone Number:</label><input type="text" id="administratorPhone">
                        <label for="administratorPassword">Password:</label><input type="password" id="administratorPassword" required>
                    </div>
                    <div class="camera-section">
                        <div class="video-capture-wrapper">
                           <video id="administrator-video" autoplay muted></video>
                           <canvas id="administrator-canvas" width="400" height="300"></canvas>
                        </div>
                        <button type="button" class="camera-button" id="openCameraBtnAdministrator">Open Camera</button>
                    </div>
                </div>
                <button type="submit" class="form-button" style="margin-top: 15px; width: 100%;">Sign Up</button>
            </form>
        `;
        document.getElementById('back-to-login').addEventListener('click', () => renderLogin(targetContentId));
        setupSignUpFormListeners(targetContentId);
    }

    async function setupSignUpFormListeners(targetContentId) {
        const form = document.getElementById(`admin-signup-form`);
        const imagePreview = document.getElementById(`administratorImagePreview`);
        setupGenericCamera('administrator');

        form.onsubmit = async (e) => {
            e.preventDefault();
            const email = document.getElementById('administratorEmail').value;
            const password = document.getElementById('administratorPassword').value;

            const imageUrl = imagePreview.src;
            if (!imageUrl || imageUrl.length < 100) {
                showAlert('Please capture an image before signing up.'); return;
            }

            const detection = await faceapi.detectSingleFace(imagePreview, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
            if (!detection) {
                showAlert('No face detected. Please retake the photo.'); return;
            }
            
            loadingOverlay.style.display = 'flex';
            loadingMessage.textContent = 'Creating account...';

            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                const descriptor = Array.from(detection.descriptor);
                const adminData = {
                    uid: user.uid,
                    name: document.getElementById('administratorName').value,
                    email: email,
                    role: document.getElementById('administratorRole').value,
                    phone: document.getElementById('administratorPhone').value,
                    imageUrl, 
                    descriptor
                };
                await addDoc(collection(db, "administrators"), adminData);
                
                loadingOverlay.style.display = 'none';
                await showAlert('Sign up successful! You can now log in.');
                renderLogin(targetContentId);

            } catch (error) {
                loadingOverlay.style.display = 'none';
                showAlert(`Sign up failed: ${error.message}`);
                console.error("Sign up error:", error);
            }
        };
    }

    async function handleLogin(e, targetContentId) {
        e.preventDefault();
        const email = document.getElementById('adminEmailLogin').value;
        const pass = document.getElementById('adminPasswordLogin').value;
        
        loadingOverlay.style.display = 'flex';
        loadingMessage.textContent = 'Logging in...';

        try {
            await signInWithEmailAndPassword(auth, email, pass);
            loadingOverlay.style.display = 'none';
            menuItems.forEach(item => item.classList.toggle('active', item.dataset.contentId === targetContentId));
            updateMainContent(targetContentId);
        } catch (error) {
            loadingOverlay.style.display = 'none';
            showAlert(`Login failed: ${error.message}`);
        }
    }

    logoutBtn.addEventListener('click', async () => {
        await signOut(auth);
        const defaultContentId = 'face-attendance'; 
        menuItems.forEach(item => item.classList.remove('active'));
        const defaultMenuItem = document.querySelector(`.menu-item[data-content-id="${defaultContentId}"]`);
        if (defaultMenuItem) defaultMenuItem.classList.add('active');
        updateMainContent(defaultContentId);
    });

    // --- RENDER LISTS ---
    function renderStudents() {
        const listDiv = document.getElementById('studentList');
        if (!listDiv) return;
        if (studentsCache.length === 0) {
            listDiv.innerHTML = '<p>No students added yet.</p>';
            return;
        }
        const table = `<table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>College ID</th><th>Class</th><th>Attendance %</th><th>Actions</th></tr></thead><tbody>
            ${studentsCache.map((s, i) => `<tr>
                <td>${i + 1}</td>
                <td><img src="${s.imageUrl}" alt="Student Image"></td>
                <td>${s.name}</td><td>${s.collegeId}</td><td>${s.studentClass}</td>
                <td data-percentage-id="${s.id}"><span class="loader-small"></span></td>
                <td><div class="action-buttons">
                    <button class="edit-btn" data-type="student" data-id="${s.id}">Edit</button>
                    <button class="delete-btn" data-type="student" data-id="${s.id}">Delete</button>
                </div></td>
            </tr>`).join('')}
        </tbody></table>`;
        listDiv.innerHTML = table;

        studentsCache.forEach(async (student) => {
            const percentage = await calculateAttendancePercentage(student.id, 'student');
            const cell = listDiv.querySelector(`td[data-percentage-id="${student.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }

    function renderFaculties() {
        const listDiv = document.getElementById('facultyList');
        if (!listDiv) return;
        if (facultiesCache.length === 0) {
            listDiv.innerHTML = '<p>No faculties added yet.</p>';
            return;
        }
        const table = `<table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>Department</th><th>Subject</th><th>Attendance %</th><th>Actions</th></tr></thead><tbody>
            ${facultiesCache.map((f, i) => `<tr>
                <td>${i + 1}</td>
                <td><img src="${f.imageUrl}" alt="Faculty Image"></td>
                <td>${f.name}</td><td>${f.department}</td><td>${f.subject}</td>
                <td data-percentage-id="${f.id}"><span class="loader-small"></span></td>
                <td><div class="action-buttons">
                    <button class="edit-btn" data-type="faculty" data-id="${f.id}">Edit</button>
                    <button class="delete-btn" data-type="faculty" data-id="${f.id}">Delete</button>
                </div></td>
            </tr>`).join('')}
        </tbody></table>`;
        listDiv.innerHTML = table;

        facultiesCache.forEach(async (faculty) => {
            const percentage = await calculateAttendancePercentage(faculty.id, 'faculty');
            const cell = listDiv.querySelector(`td[data-percentage-id="${faculty.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }
    
    function renderAdministrators() {
        const listDiv = document.getElementById('administratorList');
        if (!listDiv) return;
        if (administratorsCache.length === 0) {
            listDiv.innerHTML = '<p>No administrators added yet.</p>';
            return;
        }
        const table = `<table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>Email</th><th>Role</th><th>Attendance %</th><th>Actions</th></tr></thead><tbody>
            ${administratorsCache.map((a, i) => `<tr>
                <td>${i + 1}</td>
                <td><img src="${a.imageUrl}" alt="Admin Image"></td>
                <td>${a.name}</td><td>${a.email}</td><td>${a.role}</td>
                <td data-percentage-id="${a.id}"><span class="loader-small"></span></td>
                <td><div class="action-buttons">
                    <button class="delete-btn" data-type="administrator" data-id="${a.id}">Delete</button>
                </div></td>
            </tr>`).join('')}
        </tbody></table>`;
        listDiv.innerHTML = table;

        administratorsCache.forEach(async (admin) => {
            const percentage = await calculateAttendancePercentage(admin.id, 'administrator');
            const cell = listDiv.querySelector(`td[data-percentage-id="${admin.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }

    // --- Generic Camera Setup for Forms ---
    function setupGenericCamera(type) {
        const video = document.getElementById(`${type}-video`);
        const canvas = document.getElementById(`${type}-canvas`);
        if (!video || !canvas) return; // In case the elements don't exist
        const context = canvas.getContext('2d');
        const openCameraBtn = document.getElementById(`openCameraBtn${type.charAt(0).toUpperCase() + type.slice(1)}`);
        const imagePreview = document.getElementById(`${type}ImagePreview`);

        openCameraBtn.onclick = async () => {
            if (currentStream && currentStream.active) {
                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageDataURL = canvas.toDataURL('image/png');
                    imagePreview.src = imageDataURL;
                    imagePreview.style.display = 'block';
                    stopCamera(currentStream);
                    video.style.display = 'none';
                    openCameraBtn.textContent = 'Retake Image';
                    showAlert('Image captured!');
                } else {
                    showAlert('Camera is not ready yet. Please wait.');
                }
            } else {
                try {
                    const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    video.srcObject = mediaStream;
                    currentStream = mediaStream;
                    video.style.display = 'block';
                    openCameraBtn.textContent = 'Capture';
                } catch(err) {
                    showAlert('Camera access denied or not available.');
                }
            }
        };
    }
    
    // --- Generic Form Setup Logic with Face Detection ---
    async function setupAddFormListeners(type) {
        // Note: This function is now only for student and faculty, as admin signup is separate.
        setupGenericCamera(type);
        const form = document.getElementById(`add-${type}-form`);
        const saveBtn = document.getElementById(`save${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);
        const imagePreview = document.getElementById(`${type}ImagePreview`);

        let isEditing = !!editingId;
        if (isEditing) {
            const data = (type === 'student' ? studentsCache : facultiesCache).find(item => item.id === editingId);
            if(data) {
                document.getElementById(`${type}Name`).value = data.name;
                if(type === 'student') {
                    document.getElementById('studentCollegeId').value = data.collegeId;
                    document.getElementById('studentClass').value = data.studentClass;
                } else {
                    document.getElementById('facultyDepartment').value = data.department;
                    document.getElementById('facultySubject').value = data.subject;
                }
                imagePreview.src = data.imageUrl;
                imagePreview.style.display = 'block';
            }
            saveBtn.textContent = `Update ${type}`;
            document.querySelector('h4').textContent = `Edit ${type}`;
        } else {
             document.querySelector('h4').textContent = `Add New ${type}`;
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            const imageUrl = imagePreview.src;
            if (!imageUrl || imageUrl.length < 100) {
                showAlert('Please capture an image before saving.'); return;
            }

            const detection = await faceapi.detectSingleFace(imagePreview, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
            if (!detection) {
                showAlert('No face was detected. Please retake the photo.'); return;
            }

            const descriptor = Array.from(detection.descriptor);
            let data = {};
            if (type === 'student') {
                data = {
                    name: document.getElementById('studentName').value, collegeId: document.getElementById('studentCollegeId').value,
                    studentClass: document.getElementById('studentClass').value, phone: document.getElementById('studentPhone').value,
                    parentPhone: document.getElementById('parentPhone').value, imageUrl, descriptor
                };
            } else { // faculty
                data = {
                    name: document.getElementById('facultyName').value, department: document.getElementById('facultyDepartment').value,
                    subject: document.getElementById('facultySubject').value, phone: document.getElementById('facultyPhone').value,
                    imageUrl, descriptor
                };
            }
            
            loadingOverlay.style.display = 'flex';
            loadingMessage.textContent = 'Saving data...';

            try {
                const collectionName = type === 'faculty' ? 'faculties' : `${type}s`;
                if (isEditing) {
                    const docRef = doc(db, collectionName, editingId);
                    await updateDoc(docRef, data);
                    showAlert(`${type} data updated successfully!`);
                } else {
                    await addDoc(collection(db, collectionName), data);
                    showAlert(`${type} data saved successfully!`);
                }
                updateMainContent(`${type}-data`);
            } catch (error) {
                showAlert(`Error saving data: ${error.message}`);
                console.error("Save error:", error);
            } finally {
                loadingOverlay.style.display = 'none';
            }
        };
    }
    
    // --- ATTENDANCE LOGIC ---
    async function renderAttendanceSheet(date, type, containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error("Attendance container not found:", containerId);
            return;
        }
        container.innerHTML = `<div class="loader" style="margin: 40px auto;"></div>`;

        const database = type === 'student' ? studentsCache : (type === 'faculty' ? facultiesCache : administratorsCache);
        const collectionName = `${type}_attendance`;
        const idField = type === 'student' ? 'collegeId' : 'name';
        const secondaryField = type === 'student' ? 'collegeId' : (type === 'faculty' ? 'department' : 'role');
        const secondaryFieldHeader = type === 'student' ? 'College ID' : (type === 'faculty' ? 'Department' : 'Role');

        if (database.length === 0) {
            container.innerHTML = `<p>No ${type}s registered. Please add them first.</p>`;
            return;
        }

        const attendanceDocRef = doc(db, collectionName, date);
        const attendanceDoc = await getDoc(attendanceDocRef);
        const dailyRecords = attendanceDoc.exists() ? attendanceDoc.data().records || {} : {};

        const today = getFormattedDate(new Date());
        const isEditable = date === today;

        let tableHTML = `<h4>Showing Attendance for: ${date} ${!isEditable && !containerId.includes('-manual-') ? '(View Only)' : ''}</h4>
                                <table><thead><tr><th>S.No</th><th>Image</th><th>Name</th><th>${secondaryFieldHeader}</th><th>Status</th><th>Overall %</th></tr></thead><tbody>`;

        database.forEach((person, index) => {
            const status = dailyRecords[person.id] || 'Absent';
            const statusClass = status.toLowerCase();
            
            const statusElement = isEditable 
                ? `<button class="status-toggle ${statusClass}" data-date="${date}" data-personid="${person.id}" data-type="${type}">${status}</button>`
                : `<span class="status-toggle ${statusClass}" style="cursor: not-allowed;">${status}</span>`;

            tableHTML += `<tr>
                <td>${index + 1}</td>
                <td><img src="${person.imageUrl}" alt="${person.name}"></td>
                <td>${person.name}</td>
                <td>${person[secondaryField]}</td>
                <td>${statusElement}</td>
                <td data-percentage-id="${person.id}"><span class="loader-small"></span></td>
            </tr>`;
        });

        tableHTML += '</tbody></table>';
        container.innerHTML = tableHTML;

        database.forEach(async (person) => {
            const percentage = await calculateAttendancePercentage(person.id, type);
            const cell = container.querySelector(`td[data-percentage-id="${person.id}"]`);
            if (cell) {
                cell.textContent = percentage;
            }
        });
    }


    async function setupCombinedAttendanceCamera() {
        const video = document.getElementById('video-stream');
        const captureButton = document.getElementById('capture-image');
        const canvas = document.getElementById('photo-canvas');
        const messageDiv = document.getElementById('capture-message');
        const context = canvas.getContext('2d');
        
        try {
            if (!auth.currentUser || !auth.currentUser.isAnonymous) {
                await signInAnonymously(auth);
            }
        } catch (error) {
            console.error("Anonymous sign-in failed.", error);
            if (messageDiv) {
                messageDiv.textContent = 'Error: Anonymous sign-in is not enabled in Firebase.';
                messageDiv.style.color = 'red';
            }
            showAlert('The attendance terminal could not start. Please go to your Firebase project -> Authentication -> Sign-in method and enable "Anonymous" sign-in.');
            return;
        }

        if (currentStream) stopCamera(currentStream);

        async function startCamera() {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = mediaStream;
                video.onloadedmetadata = () => { video.play(); };
                currentStream = mediaStream;
                video.style.display = 'block';
                captureButton.style.display = 'block';
                messageDiv.textContent = 'Camera is ready. Click Capture.';
                messageDiv.style.color = 'black';
            } catch (err) {
                messageDiv.textContent = 'Camera access denied or not available.';
                messageDiv.style.color = 'red';
            }
        }
        await startCamera();

        captureButton.onclick = async () => {
            if (video.readyState !== video.HAVE_ENOUGH_DATA) {
                showAlert('Camera is not ready.'); return;
            }
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            stopCamera(currentStream);
            video.style.display = 'none';
            captureButton.style.display = 'none';
            messageDiv.textContent = 'Image captured! Matching...';
            
            const type = document.querySelector('input[name="attendanceType"]:checked').value;
            const collectionName = type === 'faculty' ? 'faculties' : `${type}s`;
            const idField = type === 'student' ? 'collegeId' : 'name';
            
            const querySnapshot = await getDocs(collection(db, collectionName));
            const database = querySnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
            
            if (database.length === 0) {
                 messageDiv.textContent = `No ${type}s registered.`;
                 messageDiv.style.color = 'red';
                 setTimeout(startCamera, 2000); return;
            }

            const labeledDescriptors = database
                .filter(p => p.descriptor)
                .map(p => new faceapi.LabeledFaceDescriptors(p[idField], [new Float32Array(p.descriptor)]));
            
            if (labeledDescriptors.length === 0) {
                messageDiv.textContent = `No ${type}s have a registered face.`;
                messageDiv.style.color = 'red';
                setTimeout(startCamera, 2000); return;
            }
            
            const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.45);
            const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
            
            if (detection) {
                const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
                if (bestMatch.label !== 'unknown') {
                    const personIdValue = bestMatch.label;
                    const person = database.find(p => p[idField] === personIdValue);
                    if (person) {
                        const today = getFormattedDate(new Date());
                        const attendanceCollectionName = `${type}_attendance`;
                        const docRef = doc(db, attendanceCollectionName, today);
                        
                        const attendanceDoc = await getDoc(docRef);
                        const dailyRecords = attendanceDoc.exists() ? attendanceDoc.data().records || {} : {};

                        if (dailyRecords[person.id] === 'Present') {
                            messageDiv.textContent = `Attendance already marked for ${person.name}.`;
                            messageDiv.style.color = '#ffc107'; // A nice yellow/orange for warning
                        } else {
                            await setDoc(docRef, {
                                records: { [person.id]: 'Present' }
                            }, { merge: true });

                            const confidence = ((1 - bestMatch.distance) * 100).toFixed(2);
                            messageDiv.textContent = `Attendance marked for ${person.name}! (Confidence: ${confidence}%)`;
                            messageDiv.style.color = 'green';
                        }
                    }
                } else {
                    messageDiv.textContent = `Face detected, but no match found.`;
                    messageDiv.style.color = 'red';
                }
            } else {
                messageDiv.textContent = 'No face detected in the image.';
                messageDiv.style.color = 'red';
            }
            setTimeout(startCamera, 3000);
        };
    }

    // --- Content Update and Event Handling ---
    function updateMainContent(contentId) {
        stopCamera(currentStream);
        contentBox.innerHTML = mainContent[contentId];
        editingId = null; editingType = '';

        if (contentId === 'student-data') {
            renderStudents();
        } else if (contentId === 'faculty-data') {
            renderFaculties();
        } else if (contentId === 'administrator') {
            renderAdministrators();
            const datePicker = document.getElementById('administrator-attendance-date');
            if (datePicker) datePicker.value = getFormattedDate(new Date());
        } else if (contentId === 'face-attendance') {
            setupCombinedAttendanceCamera();
        } else if (contentId.includes('-attendance')) {
            const type = contentId.split('-')[0];
            const datePicker = document.getElementById(`${type}-attendance-date`);
            if (datePicker) datePicker.value = getFormattedDate(new Date());
        }
    }

    function updateSubContent(contentId) {
        stopCamera(currentStream);
        contentBox.innerHTML = subContent[contentId];
        const today = getFormattedDate(new Date());
        if (contentId === 'add-student') {
            setupAddFormListeners('student');
        } else if (contentId === 'add-faculty') {
            setupAddFormListeners('faculty');
        } else if (contentId === 'mark-student-attendance-manual') {
            renderAttendanceSheet(today, 'student', 'student-manual-attendance-sheet');
        } else if (contentId === 'mark-faculty-attendance-manual') {
            renderAttendanceSheet(today, 'faculty', 'faculty-manual-attendance-sheet');
        } else if (contentId === 'mark-administrator-attendance-manual') {
            renderAttendanceSheet(today, 'administrator', 'administrator-manual-attendance-sheet');
        }
    }
    
    contentBox.addEventListener('click', async (event) => {
        const target = event.target;
        if (target.classList.contains('sub-option')) {
            updateSubContent(target.getAttribute('data-sub-content'));
        } else if (target.classList.contains('back-button')) {
            updateMainContent(target.getAttribute('data-back-to'));
        } else if (target.id === 'view-student-attendance-btn' || target.id === 'view-faculty-attendance-btn' || target.id === 'view-administrator-attendance-btn') {
            const type = target.id.split('-')[1];
            const date = document.getElementById(`${type}-attendance-date`).value;
            if (!date) { showAlert('Please select a date.'); return; }
            renderAttendanceSheet(date, type, `${type}-attendance-sheet-container`);
        } else if (target.classList.contains('status-toggle') && target.tagName === 'BUTTON') {
            const date = target.dataset.date;
            const personId = target.dataset.personid;
            const type = target.dataset.type;
            const attendanceCollectionName = `${type}_attendance`;
            const docRef = doc(db, attendanceCollectionName, date);
            const currentStatus = target.textContent;
            const newStatus = currentStatus === 'Present' ? 'Absent' : 'Present';
            try {
                await setDoc(docRef, { records: { [personId]: newStatus } }, { merge: true });
                target.textContent = newStatus;
                target.className = `status-toggle ${newStatus.toLowerCase()}`;
            } catch (error) {
                showAlert('Failed to update status.');
                console.error("Status update error:", error);
            }
        } else if (target.classList.contains('delete-btn')) {
            const id = target.getAttribute('data-id');
            const dataType = target.getAttribute('data-type');
            
            const user = auth.currentUser;
            if (!user || user.isAnonymous) {
                showAlert('You must be logged in as an administrator to perform this action.');
                return;
            }

            const password = await showPasswordConfirm(`To delete this ${dataType}, please enter your administrator password:`);

            if (password === null) {
                return; 
            }

            if (!password) {
                showAlert('Password is required for deletion.');
                return;
            }

            loadingOverlay.style.display = 'flex';
            loadingMessage.textContent = 'Verifying and deleting...';

            try {
                const credential = EmailAuthProvider.credential(user.email, password);
                await reauthenticateWithCredential(user, credential);
                
                const collectionName = dataType === 'faculty' ? 'faculties' : `${dataType}s`;
                await deleteDoc(doc(db, collectionName, id));
                showAlert(`${dataType} deleted successfully.`);

            } catch (error) {
                if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                     showAlert('Incorrect password. Deletion cancelled.');
                } else {
                     showAlert(`An error occurred: ${error.message}`);
                }
                console.error("Re-authentication or deletion error:", error);
            } finally {
                loadingOverlay.style.display = 'none';
            }
        } else if (target.classList.contains('edit-btn')) {
            editingId = target.getAttribute('data-id');
            editingType = target.getAttribute('data-type');
            updateSubContent(`add-${editingType}`);
        }
    });

    // --- Menu Item Click Handling ---
    menuItems.forEach(item => {
        item.addEventListener('click', async () => {
            const contentId = item.getAttribute('data-content-id');
            const isFaceAttendanceTab = contentId === 'face-attendance';
            
            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // If a user is already logged in as an admin, sign them out before proceeding.
            // This enforces re-authentication for every protected tab click.
            if (auth.currentUser && !auth.currentUser.isAnonymous) {
                await signOut(auth);
            }

            if (isFaceAttendanceTab) {
                // Always allow free access to the face attendance kiosk.
                updateMainContent(contentId);
            } else {
                // For any other tab, always prompt for login.
                renderLogin(contentId);
            }
        });
    });

    // The initial rendering logic is now handled by the onAuthStateChanged listener to prevent race conditions.

});


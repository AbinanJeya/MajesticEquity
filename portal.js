/**
 * Main application logic for AskJuthis Mortgages
 * Reads from config.js and injects Tailwind-based UI into the DOM.
 */

// Global Analytics Utility
window.trackEvent = function(category, action, label = '') {
    console.log(`📊 [Analytics] ${category} > ${action} ${label ? `(${label})` : ''}`);
    // In production, this would fire to Segment/Google Analytics/PostHog
}

window.pendingInviteToken = null;
window.pendingInviteContext = null;

// Global Socket Initialization
let socket = null;
if (typeof io !== 'undefined') {
    socket = io();
    
    // Listen for new messages globally
    socket.on('new_message', (msg) => {
        window.trackEvent('Messaging', 'Message Received', msg.senderRole);
        const chatContainer = document.getElementById('chat-messages');
        if (chatContainer) {
            // Determine if the incoming message was sent by the current user
            const isMe = window.userStatus && window.userStatus.role === msg.senderRole;
            
            const bubble = document.createElement('div');
            bubble.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
            bubble.innerHTML = `
                <div class="max-w-[80%] rounded-2xl p-4 ${isMe ? 'bg-secondary-fixed text-primary rounded-tr-sm' : 'bg-primary text-white border border-white/10 rounded-tl-sm'}">
                    <div class="text-[10px] uppercase font-black tracking-widest opacity-50 mb-1">${msg.senderName}</div>
                    <div class="text-sm font-medium">${msg.message}</div>
                </div>
                <div class="text-[10px] text-white/30 mt-1">${new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
            `;
            chatContainer.appendChild(bubble);
            
            // Scroll to bottom
            setTimeout(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }, 50);
        }
    });

    socket.on('status_update', (data) => {
        // We will handle real-time status updates later
        if (window.userStatus && window.userStatus.role === 'borrower') {
            window.loadPortalData(); // Refresh borrower dash quietly
        } else if (window.userStatus && window.userStatus.role === 'admin') {
            window.loadAdminData(); // Refresh admin dash quietly
        } else if (window.userStatus && window.userStatus.role === 'agent') {
            window.loadAgentData();
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const appContent = document.getElementById('app-content');

    // Check for payment success redirect
    const params = new URLSearchParams(window.location.search);
    const isPaymentSuccess = params.get('payment') === 'success';
    const inviteToken = params.get('invite');
    if (inviteToken) {
        window.pendingInviteToken = inviteToken;
        await window.loadInviteContext(inviteToken);
        window.showRegister();
        return;
    }

    if (isPaymentSuccess) {
        appContent.innerHTML = `
            <section class="min-h-screen bg-primary flex items-center justify-center">
                <div class="text-center">
                    <div class="w-24 h-24 rounded-full bg-secondary-fixed/20 flex items-center justify-center mb-8 mx-auto animate-pulse">
                        <span class="material-symbols-outlined text-6xl text-secondary-fixed">check_circle</span>
                    </div>
                    <h2 class="text-2xl font-black text-white uppercase tracking-widest mb-4">Payment Verified</h2>
                    <p class="text-white/40 font-bold uppercase tracking-widest text-xs">Finalizing your application dashboard...</p>
                </div>
            </section>
        `;
        setTimeout(async () => {
            await window.checkUserStatus();
            window.showPortalDashboard();
        }, 1200);
        return;
    }

    // Check if user is already logged in
    const token = localStorage.getItem('jwt_token');
    if (token) {
        await window.checkUserStatus();
        window.showPortalDashboard();
    } else {
        window.showLandingPage();
    }
});

// Portal Dashboard Loader
window.showPortalDashboard = function() {
    const navContainer = document.getElementById('nav-container');
    if (navContainer) navContainer.innerHTML = renderPortalNav();

    const appContent = document.getElementById('app-content');
    if (window.userStatus && window.userStatus.role === 'admin') {
        appContent.innerHTML = renderAdminDashboard();
        window.loadAdminData();
    } else if (window.userStatus && window.userStatus.role === 'agent') {
        appContent.innerHTML = renderAgentDashboard();
        window.loadAgentData();
    } else {
        appContent.innerHTML = renderPortal();
        window.loadDocuments();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.initWaveAnimation('portal-wave-svg');
}

// Sign Out
window.portalSignOut = function() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_data');
    window.userStatus = null;
    window.location.href = '/';
}

// Legacy toggle support (redirects into portal dashboard)
window.togglePortal = async function(showPortal) {
    if (showPortal) {
        const token = localStorage.getItem('jwt_token');
        if (token) {
            await window.checkUserStatus();
            window.showPortalDashboard();
        } else {
            window.showLandingPage();
        }
    } else {
        window.portalSignOut();
    }
}


function initScrollReveal() {
    const observerOptions = {
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                // Optional: stop observing once revealed
                // observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}



// Global state
let loanCompleted = false;

// --- AUTH HELPER ---
function authHeaders() {
    const token = localStorage.getItem('jwt_token');
    return token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function authFetch(url, options = {}) {
    const headers = { ...authHeaders(), ...(options.headers || {}) };
    return fetch(url, { ...options, headers });
}



// --- REAL AUTH ---
window.submitLogin = async function() {
    const emailInput = document.getElementById('login-email');
    const passInput = document.getElementById('login-password');
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (!emailInput.value || !passInput.value) {
        if (errorEl) errorEl.textContent = 'Please fill in both fields.';
        return;
    }

    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">progress_activity</span> Authenticating...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailInput.value, password: passInput.value })
        });
        const data = await res.json();
        
        if (data.mfaRequired) {
            window.mfaContext = { email: data.email, type: data.mfaType };
            const appContent = document.getElementById('app-content');
            appContent.innerHTML = renderMFAChallenge(data.mfaType);
            window.initWaveAnimation('portal-wave-svg');
            return;
        }

        if (data.verificationRequired) {
            window.mfaContext = { email: data.email };
            const appContent = document.getElementById('app-content');
            appContent.innerHTML = renderRegistrationVerification(data.email);
            window.initWaveAnimation('portal-wave-svg');
            return;
        }

        if (data.success) {
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            window.trackEvent('Auth', 'Login Success', data.user.role);
            await window.checkUserStatus();

            // Go to portal
            window.showPortalDashboard();
        } else {
            if (errorEl) errorEl.textContent = data.error || 'Login failed.';
            if (btn) btn.innerHTML = 'Log In & Authenticate';
        }
    } catch (error) {
        if (errorEl) errorEl.textContent = 'Server unavailable. Is the backend running?';
        if (btn) btn.innerHTML = 'Log In & Authenticate';
    }
}

window.submitRegister = async function() {
    const nameInput = document.getElementById('register-name');
    const emailInput = document.getElementById('register-email');
    const phoneInput = document.getElementById('register-phone');
    const passInput = document.getElementById('register-password');
    const errorEl = document.getElementById('register-error');
    const btn = document.getElementById('register-btn');

    if (!emailInput.value || !passInput.value || (phoneInput && !phoneInput.value)) {
        if (errorEl) errorEl.textContent = 'Please fill in all required fields.';
        return;
    }

    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">progress_activity</span> Creating Account...';

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: nameInput ? nameInput.value : '', 
                email: emailInput.value, 
                phone: phoneInput ? phoneInput.value : '',
                password: passInput.value,
                inviteToken: window.pendingInviteToken || undefined
            })
        });
        const data = await res.json();

        if (data.success) {
            if (data.verificationRequired) {
                window.mfaContext = { email: data.email };
                const appContent = document.getElementById('app-content');
                appContent.innerHTML = renderRegistrationVerification(data.email);
                window.initWaveAnimation('portal-wave-svg');
                return;
            }
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            window.trackEvent('Auth', 'Register Success');

            await window.checkUserStatus();

            const appContent = document.getElementById('app-content');
            if (window.userStatus && window.userStatus.role === 'admin') {
                appContent.innerHTML = renderAdminDashboard();
                window.loadAdminData();
            } else {
                appContent.innerHTML = renderPortal();
                window.loadDocuments();
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            initScrollReveal();
        } else {
            if (errorEl) errorEl.textContent = data.error || 'Registration failed.';
            if (btn) btn.innerHTML = 'Create Secure Account';
        }
    } catch (error) {
        if (errorEl) errorEl.textContent = 'Server unavailable. Is the backend running?';
        if (btn) btn.innerHTML = 'Create Secure Account';
    }
}

window.loadInviteContext = async function(token) {
    try {
        const res = await fetch('/api/invites/' + encodeURIComponent(token));
        const data = await res.json();
        if (res.ok) {
            window.pendingInviteContext = data.invite;
        } else {
            window.pendingInviteContext = { error: data.error || 'Invite unavailable.' };
        }
    } catch (error) {
        window.pendingInviteContext = { error: 'Invite unavailable.' };
    }
}

window.renderLandingNav = function() {
    return `
    <nav class="fixed top-0 w-full z-50 bg-slate-900/60 dark:bg-slate-950/60 backdrop-blur-xl border-b border-white/10 dark:border-white/5 shadow-2xl shadow-slate-950/20">
        <div class="flex justify-between items-center h-20 px-8 max-w-7xl mx-auto">
            <div class="text-2xl font-bold tracking-tighter text-slate-50 dark:text-slate-50 font-headline flex items-center">Majestic<span class="font-script text-secondary-fixed text-glow normal-case font-normal ml-2 text-[2.75rem] leading-none translate-y-1.5">Equity</span></div>
            <div class="hidden md:flex items-center space-x-10 font-manrope font-medium tracking-tight text-sm">
                <a class="text-slate-300 hover:text-white transition-colors" href="#">Solutions</a>
                <a class="text-slate-300 hover:text-white transition-colors" href="#">How it Works</a>
                <a class="text-slate-300 hover:text-white transition-colors" href="#">Rates</a>
                <a class="text-slate-300 hover:text-white transition-colors" href="#">Security</a>
            </div>
            <div class="flex items-center gap-6">
                <button onclick="window.showLogin()" class="text-slate-300 text-sm font-medium hover:text-white transition-colors">Log In</button>
                <button onclick="window.showRegister()" class="bg-secondary-fixed text-on-secondary-fixed px-6 py-2.5 rounded-lg text-sm font-bold tracking-tight hover:bg-secondary-fixed-dim transition-all duration-300 active:scale-95">
                    Get Started
                </button>
            </div>
        </div>
    </nav>
    `;
};

window.renderAuthNav = function() {
    return `
    <nav class="sticky top-0 z-50 bg-primary/95 border-b border-white/10">
        <div class="px-4 sm:px-8 lg:px-12">
            <div class="flex h-20 items-center justify-between">
                <div class="flex items-center">
                    <a href="javascript:void(0)" onclick="window.showLandingPage()" class="text-2xl font-bold tracking-tight text-white uppercase flex items-center">Majestic<span class="text-secondary-fixed font-script normal-case font-normal ml-2 text-[2.75rem] leading-none translate-y-1.5">Equity</span></a>
                </div>
                <div class="flex items-center space-x-4">
                    <button class="text-sm font-medium hover:text-secondary-fixed transition-colors text-white/60 px-3 py-2" onclick="window.showLandingPage()">← Back to Home</button>
                </div>
            </div>
        </div>
    </nav>
    `;
};

window.renderPortalNav = function() {
    const isAgent = window.userStatus && window.userStatus.role === 'agent';
    const isAdmin = window.userStatus && window.userStatus.role === 'admin';
    
    return `
    <nav class="sticky top-0 z-50 bg-primary/95 border-b border-white/10">
        <div class="px-4 sm:px-8 lg:px-12">
            <div class="flex h-20 items-center justify-between">
                <div class="flex items-center gap-4">
                    <a href="javascript:void(0)" class="text-2xl font-bold tracking-tight text-white uppercase flex items-center">Majestic<span class="text-secondary-fixed font-script normal-case font-normal ml-2 text-[2.75rem] leading-none translate-y-1.5">Equity</span></a>
                    ${isAgent ? '<span class="hidden md:block px-3 py-1 bg-secondary-fixed/10 border border-secondary-fixed/20 text-secondary-fixed text-[10px] font-black uppercase tracking-widest rounded-full ml-4">Expert Portal</span>' : ''}
                    ${isAdmin ? '<span class="hidden md:block px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-full ml-4">Admin Control</span>' : ''}
                </div>
                <div class="flex items-center space-x-4">
                    <button id="portal-sign-out-btn" class="px-6 py-2 rounded-full border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-all font-bold text-sm" onclick="window.portalSignOut()">Sign Out</button>
                </div>
            </div>
        </div>
    </nav>
    `;
};

window.renderLandingPage = function() {
    return `
        <!-- Hero Section -->
        <header class="relative min-h-screen flex items-center pt-20 overflow-hidden bg-primary-container">
            <!-- Animated Wave Mesh Background -->
            <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                <!-- JS-animated wave canvas -->
                <svg id="hero-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.22;"></svg>
                <!-- Radial glow accent in top-right -->
                <div class="absolute top-0 right-0 w-[70%] h-[70%]" style="background: radial-gradient(ellipse at 80% 30%, rgba(211,189,115,0.06) 0%, transparent 60%);"></div>
            </div>
            
            <div class="relative z-20 max-w-7xl mx-auto px-8 w-full grid md:grid-cols-12 gap-12">
                <div class="md:col-span-8 lg:col-span-7">
                    <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-secondary-fixed/30 bg-secondary-fixed/5 text-secondary-fixed text-xs font-bold uppercase tracking-[0.2em] mb-8">
                        <span class="w-1.5 h-1.5 rounded-full bg-secondary-fixed"></span> Mortgage Refined
                    </div>
                    
                    <h1 class="font-headline font-extrabold text-5xl md:text-7xl lg:text-8xl text-white leading-[1.1] tracking-tight mb-8">
                        The <span class="font-script text-secondary-fixed text-6xl md:text-8xl lg:text-9xl normal-case font-normal -rotate-2 inline-block px-2 text-glow">modern</span> Way to Mortgage
                    </h1>
                    
                    <p class="text-lg md:text-xl text-on-primary-container max-w-xl mb-12 font-light leading-relaxed">
                        Experience a sanctuary of financial clarity. MajesticEquity combines military-grade security with an editorial approach to home financing, ensuring every step is as sophisticated as the home you're building.
                    </p>
                    
                    <div class="flex flex-col sm:flex-row gap-5">
                        <button onclick="window.showRegister()" class="px-8 py-4 bg-secondary-fixed text-on-secondary-fixed rounded-lg font-bold tracking-tight text-lg shadow-xl shadow-secondary-fixed/10 hover:bg-secondary-fixed-dim hover:-translate-y-0.5 transition-all duration-300 active:scale-95">Get Started</button>
                        <button class="px-8 py-4 glass-card text-secondary-fixed rounded-lg font-bold tracking-tight text-lg border border-secondary-fixed/20 hover:bg-white/10 transition-all duration-300">How it Works</button>
                    </div>
                </div>
            </div>

            <!-- Asymmetric Floating Card Decoration -->
            <div class="absolute right-0 bottom-24 hidden lg:block w-1/3 z-20">
                <div class="glass-card rounded-l-editorial-lg p-10 editorial-shadow border-r-0">
                    <div class="flex items-center gap-4 mb-6">
                        <div class="w-12 h-12 rounded-full bg-secondary-fixed/10 flex items-center justify-center text-secondary-fixed">
                            <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">verified_user</span>
                        </div>
                        <div>
                            <div class="text-white font-headline font-bold">Institutional Security</div>
                            <div class="text-on-primary-container text-xs">SOC2 Type II Compliant</div>
                        </div>
                    </div>
                    <div class="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                        <div class="h-full w-2/3 bg-secondary-fixed rounded-full"></div>
                    </div>
                    <div class="mt-4 flex justify-between text-xs font-medium uppercase tracking-wider text-slate-400">
                        <span>Processing Equity</span>
                        <span class="text-secondary-fixed">67% Complete</span>
                    </div>
                </div>
            </div>
        </header>

        <!-- Trust Bar Section -->
        <section class="py-16 bg-surface-container-low overflow-hidden">
            <div class="max-w-7xl mx-auto px-8">
                <div class="text-center mb-10"><span class="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-outline">Powered by Institutional-Grade Infrastructure</span></div>
                <div class="flex flex-wrap justify-center items-center gap-x-16 gap-y-12 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
                    <span class="font-headline font-extrabold text-2xl tracking-tighter text-on-surface">Plaid</span>
                    <span class="font-headline font-extrabold text-2xl tracking-tighter text-on-surface">AWS</span>
                    <div class="flex items-center gap-2"><span class="material-symbols-outlined text-on-surface">shield</span><span class="font-headline font-bold text-lg text-on-surface">SOC2 Certified</span></div>
                    <span class="font-headline font-extrabold text-2xl tracking-tighter text-on-surface">TransUnion</span>
                </div>
            </div>
        </section>

        <!-- Feature Grid Section -->
        <section class="py-32 bg-white relative">
            <div class="max-w-7xl mx-auto px-8">
                <div class="grid md:grid-cols-3 gap-10">
                    <!-- Card 1 -->
                    <div class="bg-surface-container-lowest p-10 rounded-editorial-lg rounded-tr-none border-b-4 border-secondary-fixed/20 editorial-shadow hover:-translate-y-2 transition-transform duration-500 group">
                        <div class="mb-8"><span class="material-symbols-outlined text-4xl text-secondary" data-icon="description">description</span></div>
                        <h3 class="font-headline font-bold text-2xl text-primary mb-4 leading-tight">Seamless Document Management</h3>
                        <p class="text-on-surface-variant leading-relaxed font-light">Automatic verification and secure vaulting for your most sensitive financial records. No paper, no friction.</p>
                        <div class="mt-8 pt-8 border-t border-outline-variant/10 opacity-0 group-hover:opacity-100 transition-opacity"><a class="text-secondary font-bold text-sm uppercase tracking-widest flex items-center gap-2" href="#">Learn More <span class="material-symbols-outlined text-sm">arrow_forward</span></a></div>
                    </div>
                    <!-- Card 2 -->
                    <div class="bg-primary-container p-10 rounded-editorial-lg rounded-tr-none border-b-4 border-secondary-fixed editorial-shadow hover:-translate-y-2 transition-transform duration-500 group">
                        <div class="mb-8"><span class="material-symbols-outlined text-4xl text-secondary-fixed" data-icon="analytics">analytics</span></div>
                        <h3 class="font-headline font-bold text-2xl text-white mb-4 leading-tight">Real-Time Journey Tracking</h3>
                        <p class="text-on-primary-container leading-relaxed font-light">Visualize every milestone of your mortgage journey with precision tracking and instant status notifications.</p>
                        <div class="mt-8 pt-8 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity"><a class="text-secondary-fixed font-bold text-sm uppercase tracking-widest flex items-center gap-2" href="#">Explore Tracking <span class="material-symbols-outlined text-sm">arrow_forward</span></a></div>
                    </div>
                    <!-- Card 3 -->
                    <div class="bg-surface-container-lowest p-10 rounded-editorial-lg rounded-tr-none border-b-4 border-secondary-fixed/20 editorial-shadow hover:-translate-y-2 transition-transform duration-500 group">
                        <div class="mb-8"><span class="material-symbols-outlined text-4xl text-secondary" data-icon="handshake">handshake</span></div>
                        <h3 class="font-headline font-bold text-2xl text-primary mb-4 leading-tight">Expert Collaboration</h3>
                        <p class="text-on-surface-variant leading-relaxed font-light">A direct line to elite specialists. Bridge the gap between digital speed and human strategic guidance.</p>
                        <div class="mt-8 pt-8 border-t border-outline-variant/10 opacity-0 group-hover:opacity-100 transition-opacity"><a class="text-secondary font-bold text-sm uppercase tracking-widest flex items-center gap-2" href="#">Meet Advisors <span class="material-symbols-outlined text-sm">arrow_forward</span></a></div>
                    </div>
                </div>
            </div>
        </section>

        <!-- The Atelier Experience Marketing Section -->
        <section class="relative bg-surface py-32 overflow-hidden">
            <div class="max-w-7xl mx-auto px-8 grid lg:grid-cols-2 gap-20 items-center">
                <div class="relative order-2 lg:order-1">
                    <div class="relative z-10 rounded-editorial-lg overflow-hidden editorial-shadow">
                        <img alt="Luxury Interior" class="w-full h-[600px] object-cover" data-alt="ultra modern minimalist interior with floor to ceiling windows showing a garden and high end designer furniture in warm sunlight" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCpRWZ2TICzhI2WrbSeQbORiApcYbxlH8ApluvGEq-lARlULhqfhiGGCkLONZIRLm8qgRmOZbWoqqzSaA394Xf8OP76z_0eWrCiJNYWJOQur_UFJeQOtLRN06bpcw79Tr2cIBOns5nCa0n4AsxQLcOWPBkm1lecdybzsvdax_WbO4hrGwAq3aSWVMDQAMjGQPUziU5UN17uvlvXQj14pjxuewgiVspmlxOddSbOt50czG8f4NklP2-Hes9nqU0JHT-udHmU_8WdNHfs"/>
                    </div>
                    <div class="absolute -bottom-10 -right-10 z-20 glass-card p-8 rounded-editorial w-72 editorial-shadow hidden md:block">
                        <div class="text-primary font-headline font-bold text-xl mb-2">Legacy Focused</div>
                        <p class="text-on-surface-variant text-sm font-light">Building more than just a home, we're building your generational wealth through strategic equity planning.</p>
                    </div>
                </div>
                <div class="order-1 lg:order-2">
                    <span class="text-secondary font-bold uppercase tracking-[0.4em] text-xs block mb-6">The Atelier Experience</span>
                    <h2 class="font-headline font-extrabold text-4xl md:text-5xl text-primary mb-10 leading-tight">Mortgage strategy, <br/><span class="text-secondary font-script text-6xl normal-case font-normal inline-block mt-2">tailored like fine art.</span></h2>
                    <div class="space-y-12">
                        <div class="flex gap-6">
                            <div class="shrink-0 w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container"><span class="material-symbols-outlined text-2xl">architecture</span></div>
                            <div>
                                <h4 class="font-headline font-bold text-xl text-primary mb-2">Strategic Tailoring</h4>
                                <p class="text-on-surface-variant leading-relaxed">Every mortgage is unique. Our platform adapts to your long-term financial goals, providing custom paths for every investor and homeowner.</p>
                            </div>
                        </div>
                        <div class="flex gap-6">
                            <div class="shrink-0 w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container"><span class="material-symbols-outlined text-2xl">biotech</span></div>
                            <div>
                                <h4 class="font-headline font-bold text-xl text-primary mb-2">Precision Tech</h4>
                                <p class="text-on-surface-variant leading-relaxed">Our proprietary algorithms analyze thousands of data points to secure the most favorable rates in the contemporary market.</p>
                            </div>
                        </div>
                        <div class="flex gap-6">
                            <div class="shrink-0 w-12 h-12 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container"><span class="material-symbols-outlined text-2xl">verified</span></div>
                            <div>
                                <h4 class="font-headline font-bold text-xl text-primary mb-2">Authority &amp; Trust</h4>
                                <p class="text-on-surface-variant leading-relaxed">Built on a foundation of regulatory excellence and consumer protection, MajesticEquity is your guardian in the lending space.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Final CTA Section -->
        <section class="pb-32 px-8 bg-surface">
            <div class="max-w-7xl mx-auto">
                <div class="relative bg-secondary-fixed rounded-editorial-lg p-12 md:p-24 overflow-hidden text-center editorial-shadow">
                    <div class="absolute inset-0 opacity-10 pointer-events-none mix-blend-overlay">
                        <div class="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary via-transparent to-transparent"></div>
                    </div>
                    <div class="relative z-10 max-w-2xl mx-auto">
                        <h2 class="font-headline font-extrabold text-4xl md:text-5xl text-on-secondary-fixed mb-8 leading-tight">Ready to begin your modern mortgage journey?</h2>
                        <p class="text-on-secondary-fixed-variant text-lg mb-12 font-medium">Join thousands of borrowers who have discovered the editorial way to home ownership. Simple. Secure. Sophisticated.</p>
                        <div class="flex flex-col sm:flex-row justify-center gap-6">
                            <button onclick="window.showRegister()" class="bg-primary text-white px-10 py-5 rounded-lg font-bold text-lg hover:bg-primary-container transition-all shadow-lg active:scale-95">Start Your Free Application</button>
                            <button class="bg-transparent border-2 border-on-secondary-fixed text-on-secondary-fixed px-10 py-5 rounded-lg font-bold text-lg hover:bg-on-secondary-fixed hover:text-secondary-fixed transition-all active:scale-95">Contact a Specialist</button>
                        </div>
                        <p class="mt-8 text-on-secondary-fixed-variant text-xs font-bold uppercase tracking-[0.2em]">No hard credit check required to start</p>
                    </div>
                </div>
            </div>
        </section>

        <!-- Footer Shell -->
        <footer class="w-full pt-20 pb-10 bg-slate-900 dark:bg-slate-950 tonal-shift border-t border-white/5">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-12 px-8 max-w-7xl mx-auto">
                <div class="md:col-span-1">
                    <div class="text-xl font-bold text-slate-100 mb-4 block font-headline flex items-center">Majestic<span class="font-script text-secondary-fixed text-glow normal-case font-normal ml-2 text-[2.25rem] leading-none translate-y-1">Equity</span></div>
                    <p class="font-inter text-sm leading-relaxed text-slate-400">The intersection of financial architectural precision and high-end mortgage services.</p>
                </div>
                <div>
                    <h4 class="text-amber-200 font-semibold mb-6 font-headline">Solutions</h4>
                    <ul class="space-y-4">
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Purchase</a></li>
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Refinance</a></li>
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Equity Access</a></li>
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Rates &amp; Planning</a></li>
                    </ul>
                </div>
                <div>
                    <h4 class="text-amber-200 font-semibold mb-6 font-headline">Company</h4>
                    <ul class="space-y-4">
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">How it Works</a></li>
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Security</a></li>
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Privacy Policy</a></li>
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Terms of Service</a></li>
                    </ul>
                </div>
                <div>
                    <h4 class="text-amber-200 font-semibold mb-6 font-headline">Compliance</h4>
                    <ul class="space-y-4">
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">Compliance Docs</a></li>
                        <li><a class="text-slate-400 hover:text-amber-200 transition-colors hover:translate-x-1 inline-block" href="#">ADA Accessibility</a></li>
                        <li class="flex items-center gap-2 text-slate-400 text-xs mt-6"><span class="material-symbols-outlined text-sm">home</span> Equal Housing Lender</li>
                    </ul>
                </div>
            </div>
            <div class="max-w-7xl mx-auto px-8 mt-20 pt-10 border-t border-white/5 text-center">
                <p class="font-inter text-xs leading-relaxed text-slate-500">© 2024 MajesticEquity Mortgage Solutions. All Rights Reserved. NMLS Consumer Access #123456.</p>
            </div>
        </footer>
    `;
};

// --- Reusable Wave Animation Engine ---
window.initWaveAnimation = function(svgId) {
    const svg = document.getElementById(svgId);
    if (!svg) return;

    const NS = 'http://www.w3.org/2000/svg';
    const waves = [
        { y: 400, amp: 40, speed: 0.0004, phase: 0,    color: 'rgba(211,189,115,0.7)',  w: 1.2 },
        { y: 350, amp: 35, speed: 0.00035, phase: 1.2,  color: 'rgba(211,189,115,0.5)', w: 0.9 },
        { y: 300, amp: 30, speed: 0.0003, phase: 2.4,  color: 'rgba(211,189,115,0.4)',  w: 0.7 },
        { y: 250, amp: 25, speed: 0.00025, phase: 3.6,  color: 'rgba(211,189,115,0.35)', w: 0.5 },
        { y: 200, amp: 20, speed: 0.0002, phase: 4.8,  color: 'rgba(211,189,115,0.25)', w: 0.5 },
        { y: 500, amp: 35, speed: 0.00032, phase: 0.8,  color: 'rgba(211,189,115,0.3)',  w: 0.7 },
        { y: 150, amp: 15, speed: 0.00018, phase: 5.5,  color: 'rgba(211,189,115,0.15)', w: 0.4 },
        { y: 550, amp: 25, speed: 0.00028, phase: 2.0,  color: 'rgba(211,189,115,0.2)',  w: 0.5 },
    ];

    const paths = waves.map(w => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', w.color);
        p.setAttribute('stroke-width', String(w.w));
        svg.appendChild(p);
        return p;
    });

    function buildD(baseY, amplitude, time, speed, phase) {
        const t = time * speed + phase;
        const pts = 7;
        let d = '';
        for (let i = 0; i <= pts; i++) {
            const x = (1200 / pts) * i;
            const y = baseY + Math.sin(t + i * 0.9) * amplitude + Math.cos(t * 0.7 + i * 1.3) * (amplitude * 0.4);
            if (i === 0) {
                d += 'M' + x.toFixed(1) + ',' + y.toFixed(1);
            } else {
                const cpx1 = (1200 / pts) * (i - 0.6);
                const cpy1 = baseY + Math.sin(t + (i - 0.6) * 0.9) * amplitude + Math.cos(t * 0.7 + (i - 0.6) * 1.3) * (amplitude * 0.4);
                const cpx2 = (1200 / pts) * (i - 0.3);
                const cpy2 = baseY + Math.sin(t + (i - 0.3) * 0.9) * amplitude + Math.cos(t * 0.7 + (i - 0.3) * 1.3) * (amplitude * 0.4);
                d += ' C' + cpx1.toFixed(1) + ',' + cpy1.toFixed(1) + ' ' + cpx2.toFixed(1) + ',' + cpy2.toFixed(1) + ' ' + x.toFixed(1) + ',' + y.toFixed(1);
            }
        }
        return d;
    }

    let animId;
    function tick(time) {
        if (!document.getElementById(svgId)) { cancelAnimationFrame(animId); return; }
        waves.forEach((w, i) => {
            paths[i].setAttribute('d', buildD(w.y, w.amp, time, w.speed, w.phase));
        });
        animId = requestAnimationFrame(tick);
    }
    animId = requestAnimationFrame(tick);
};

window.showLandingPage = function() {
    const navContainer = document.getElementById('nav-container');
    if (navContainer) navContainer.innerHTML = renderLandingNav();
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderLandingPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.initWaveAnimation('hero-wave-svg');
}

window.showRegister = function() {
    const navContainer = document.getElementById('nav-container');
    if (navContainer) navContainer.innerHTML = renderAuthNav();
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderRegister();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.initWaveAnimation('auth-wave-svg');
}

window.showLogin = function() {
    const navContainer = document.getElementById('nav-container');
    if (navContainer) navContainer.innerHTML = renderAuthNav();
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderLogin();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.initWaveAnimation('auth-wave-svg');
}

window.verifyMFA = function() {
    window.showPortalDashboard();
}

window.startWizard = function(step = 1) {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderWizard(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.initWaveAnimation('portal-wave-svg');
}

window.nextWizardStep = function(currentStep) {
    if (currentStep < 7) {
        window.startWizard(currentStep + 1);
    } else {
        window.submitApplication();
    }
}

// --- PHASE 9: NEW LOGIC ---
window.submitApplication = async function() {
    try {
        const appContent = document.getElementById('app-content');
        appContent.innerHTML = `
            <section class="min-h-screen bg-primary flex items-center justify-center">
                <div class="text-center">
                    <span class="material-symbols-outlined animate-spin text-6xl text-secondary-fixed mb-6">progress_activity</span>
                    <h2 class="text-2xl font-black text-white uppercase tracking-widest">Submitting Application...</h2>
                </div>
            </section>
        `;

        const loanAmount = parseInt(document.getElementById('step5-price')?.value || '0');
        const propertyAddress = document.getElementById('step5-property-type')?.value + " Application";
        const loanType = 'Purchase';

        // Collect History Rows
        const employmentHistory = Array.from(document.querySelectorAll('.employment-row')).map(row => ({
            employerName: row.querySelector('.employer-name').value,
            title: row.querySelector('.employer-title').value,
            startDate: row.querySelector('.employer-start').value,
            monthlyIncome: parseFloat(row.querySelector('.employer-income').value || '0')
        })).filter(e => e.employerName);

        const residentialHistory = Array.from(document.querySelectorAll('.residency-row')).map(row => ({
            address: row.querySelector('.res-address').value,
            status: row.querySelector('.res-status').value,
            startDate: '2022-01-01' // Mock for simplicity in this pass
        })).filter(r => r.address);

        const payload = {
            loanAmount: loanAmount,
            propertyAddress: document.getElementById('cp-address')?.value || 'TBD',
            loanType: loanType,
            propertyDetails: {
                propertyType: document.getElementById('step5-property-type')?.value,
                occupancyType: document.getElementById('step5-occupancy-type')?.value,
                purchasePrice: loanAmount,
                estimatedValue: loanAmount
            },
            employmentHistory,
            residentialHistory,
            declarations: {
                outstandingJudgments: document.querySelector('input[name="decl-judgments"]:checked')?.value === 'yes',
                bankruptcy: document.querySelector('input[name="decl-bankruptcy"]:checked')?.value === 'yes',
                lawsuits: document.querySelector('input[name="decl-lawsuits"]:checked')?.value === 'yes',
                usCitizen: document.querySelector('input[name="decl-citizen"]:checked')?.value === 'yes'
            }
        };

        const response = await authFetch('/api/applications/submit', { 
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        await window.checkUserStatus();
        window.showPortalDashboard();
    } catch (error) {
        console.error('Submission failed:', error);
    }
}

// --- REAL PLAID INTEGRATION ---
let plaidHandler = null;

window.initializePlaidLink = async function(isIncomeStep = false) {
    try {
        const response = await fetch('/api/create_link_token', { method: 'POST', headers: authHeaders() });
        const data = await response.json();
        
        if (data.link_token) {
            plaidHandler = Plaid.create({
                token: data.link_token,
                onSuccess: (public_token, metadata) => {
                    window.trackEvent('Verification', 'Plaid Success');
                    console.log('Plaid Link Success:', public_token);
                    window.handlePlaidSuccess(public_token, isIncomeStep);
                },
                onLoad: () => { console.log('Plaid Loaded'); },
                onExit: (err, metadata) => { if (err) console.error('Plaid Exit Error:', err); },
                onEvent: (eventName, metadata) => { console.log('Plaid Event:', eventName); }
            });
            plaidHandler.open();
        } else {
            console.error('Plaid Server Error:', data);
            alert(`Plaid Error: ${data.error || 'Unknown Error'}.`);
        }
    } catch (error) {
        console.error('Network Error:', error);
        alert('Could not connect to the backend. Please ensure server is running.');
    }
}

window.handlePlaidSuccess = async function(public_token, isIncomeStep) {
    const btn = isIncomeStep ? document.getElementById('payroll-sync-box') : document.querySelector('button[onclick="window.initializePlaidLink()"]');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-4xl mb-4">progress_activity</span><span class="text-xs uppercase tracking-widest">Securing Bank Data...</span>';

    try {
        const response = await fetch('/api/exchange_public_token', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ public_token })
        });
        const result = await response.json();
        
        if (result.status === 'success') {
            if (isIncomeStep) {
                // Call Income Sync
                await authFetch('/api/applications/sync_income', { method: 'POST', body: JSON.stringify({}) });
                window.trackEvent('Verification', 'Real Bank Income Saved to DB');
                window.showSyncProcessing(); // Show success UI
            } else {
                // Legacy Asset Sync
                await authFetch('/api/applications/sync_assets', { method: 'POST', body: JSON.stringify({}) });
                window.trackEvent('Verification', 'Real Bank Assets Saved to DB');
                window.nextWizardStep(3); // Successfully linked!
            }
        }
    } catch (error) {
        console.error('Error exchanging public token:', error);
        alert("Failed to securely connect bank data.");
    }
}

window.showSyncProcessing = function() {
    const container = document.getElementById('sync-status-container');
    const syncBox = document.getElementById('payroll-sync-box');
    const nextBtn = document.getElementById('wizard-next-btn');
    
    if (container && syncBox) {
        syncBox.classList.add('hidden');
        container.classList.remove('hidden');
        
        container.innerHTML = `
            <div class="flex flex-col items-center py-10">
                <div class="relative w-20 h-20 mb-6">
                    <div class="absolute inset-0 border-4 border-secondary-fixed/10 rounded-full"></div>
                    <div class="absolute inset-0 border-4 border-secondary-fixed rounded-full border-t-transparent animate-spin"></div>
                </div>
                <p class="text-white font-bold uppercase tracking-[0.2em] text-[10px] animate-pulse">Syncing Financial Records...</p>
                <p class="text-white/30 text-[10px] mt-2 font-bold uppercase tracking-widest">Secure Bank-Level Encryption Active</p>
            </div>
        `;

        setTimeout(async () => {
            // Save to Backend (Phase 12 Hardening)
            try {
                await authFetch('/api/applications/sync_income', {
                    method: 'POST',
                    body: JSON.stringify({ income: 4582.50, source: 'ADP Global' })
                });
                window.trackEvent('Verification', 'Income Saved to DB');
            } catch (err) {
                console.error('Failed to sync income to DB:', err);
            }

            container.innerHTML = renderSyncResult();
            if (nextBtn) {
                nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                nextBtn.removeAttribute('disabled');
                nextBtn.innerHTML = 'Review & Continue';
            }
            window.trackEvent('Payroll Sync', 'Completed');
        }, 3000);
    }
}

window.startAssetSync = function() {
    const box = document.getElementById('asset-sync-box');
    const nextBtn = document.getElementById('assets-next-btn');
    
    if (box) box.innerHTML = '<span class="material-symbols-outlined animate-spin text-4xl text-secondary-fixed mb-4 mx-auto">progress_activity</span><span class="text-xs text-secondary-fixed uppercase tracking-widest font-bold">Scanning Balances...</span>';

    setTimeout(async () => {
        try {
            await authFetch('/api/applications/sync_assets', { method: 'POST', body: JSON.stringify({}) });
            window.trackEvent('Verification', 'Real Bank Assets Saved to DB');
            
            if (box) {
                box.classList.replace('bg-primary', 'bg-green-500/10');
                box.classList.replace('border-white/10', 'border-green-500/30');
                box.innerHTML = `
                    <div class="flex flex-col items-center">
                        <div class="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 mb-4">
                            <span class="material-symbols-outlined text-3xl">check</span>
                        </div>
                        <span class="text-green-400 font-bold uppercase tracking-widest text-xs">Balances Verified Successfully</span>
                    </div>
                `;
            }
            if (nextBtn) {
                nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                nextBtn.removeAttribute('disabled');
            }
        } catch (err) {
            console.error('Failed to sync assets:', err);
            alert('Failed to sync balances. You might need to launch the Secure Link first.');
            if (box) box.innerHTML = '<span class="text-red-400">Sync Failed</span>';
        }
    }, 2000);
}

function renderSyncResult() {
    return `
        <div class="w-full bg-white/5 rounded-3xl p-8 border border-green-500/30 text-left mb-8 reveal reveal-up">
            <div class="flex items-center gap-3 mb-6">
                <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-500">
                    <span class="material-symbols-outlined">check</span>
                </div>
                <span class="text-[10px] font-black text-white uppercase tracking-widest">Verified Multi-Source Income Data</span>
            </div>
            
            <div class="grid grid-cols-2 gap-6">
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Payroll Provider</span>
                    <span class="text-white font-bold">ADP Global</span>
                </div>
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Sync Date</span>
                    <span class="text-white font-bold">Mar 21, 2026</span>
                </div>
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Avg. Gross Pay</span>
                    <span class="text-secondary-fixed font-black">$4,582.50</span>
                </div>
                <div>
                    <span class="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Status</span>
                    <span class="text-white font-bold">Fully Verified</span>
                </div>
            </div>
            
            <div class="mt-6 pt-4 border-t border-white/10">
                <div class="flex items-center justify-between">
                     <span class="text-[9px] font-black text-white/30 uppercase tracking-widest">YTD Earnings (Verified)</span>
                     <span class="text-white/60 font-bold">$22,912.50</span>
                </div>
            </div>
        </div>
    `;
}

function renderWizard(step) {
    const steps = [
        { id: 1, title: 'Identity', icon: 'badge', desc: 'Secure ID Verification' },
        { id: 2, title: 'Payroll', icon: 'work', desc: 'Direct Employer Sync' },
        { id: 3, title: 'Assets', icon: 'account_balance', desc: 'Direct Bank Link' },
        { id: 4, title: 'Credit', icon: 'trending_up', desc: 'Secure Credit Pull' },
        { id: 5, title: 'Loan', icon: 'home', desc: 'Property & Loan Details' },
        { id: 6, title: 'History', icon: 'history', desc: '2-Year Tracking' },
        { id: 7, title: 'Final', icon: 'description', desc: 'Legal Declarations' }
    ];


    const currentStep = steps.find(s => s.id === step);

    return `
        <section class="min-h-screen bg-primary pt-32 pb-24 relative overflow-hidden">
            <!-- Animated Wave Mesh Background -->
            <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                <!-- JS-animated wave canvas -->
                <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.22;"></svg>
                <!-- Radial glow accent in top-right -->
                <div class="absolute top-0 right-0 w-[70%] h-[70%]" style="background: radial-gradient(ellipse at 80% 30%, rgba(211,189,115,0.06) 0%, transparent 60%);"></div>
            </div>

            <div class="max-w-4xl mx-auto px-4 relative z-10">
                <!-- Wizard Header -->
                <div class="flex flex-col items-center text-center mb-16 reveal reveal-up">
                    <div class="flex items-center gap-4 mb-8">
                        ${steps.map(s => `
                            <div class="flex items-center gap-2">
                                <div class="w-10 h-10 rounded-full flex items-center justify-center font-black text-xs ${s.id === step ? 'bg-secondary-fixed text-primary shadow-lg shadow-secondary-fixed/20' : (s.id < step ? 'bg-green-500 text-white' : 'bg-white/10 text-white/30')}">
                                    ${s.id < step ? '<span class="material-symbols-outlined">check</span>' : s.id}
                                </div>
                                 <span class="hidden md:block text-[10px] font-black uppercase tracking-widest ${s.id === step ? 'text-white' : 'text-white/20'}">${s.title}</span>
                                ${s.id < 7 ? `<div class="w-8 h-px ${s.id < step ? 'bg-green-500/50' : 'bg-white/10'}"></div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    <h2 class="text-4xl md:text-5xl font-black text-white mb-4 uppercase tracking-tight">Step ${step}: <span class="text-secondary-fixed">${currentStep.title}</span></h2>
                    <p class="text-white/40 font-bold uppercase tracking-[0.2em] text-sm">${currentStep.desc}</p>
                </div>

                <!-- Wizard Content Card -->
                <div class="p-10 md:p-16 rounded-[4rem] glass-card border-white/10 shadow-2xl reveal reveal-up">
                    ${step === 1 ? `
                        <div class="flex flex-col items-center text-center">
                            <div class="w-32 h-32 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-10">
                                <span class="material-symbols-outlined text-secondary-fixed text-6xl">badge</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Drivers License or Passport</h3>
                            <p class="text-white/40 mb-12 max-w-md mx-auto leading-relaxed">We use **Persona** to verify your identity. Please have your ID ready. This process is encrypted and takes less than 60 seconds.</p>
                            
                            <div id="persona-verification-container" class="w-full max-w-sm mb-12">
                                <button onclick="window.startPersonaVerification()" id="persona-start-btn" class="w-full py-12 rounded-3xl border-2 border-dashed border-white/10 bg-white/5 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition-all group mb-4">
                                    <span class="material-symbols-outlined text-4xl text-white/20 group-hover:text-secondary-fixed mb-4 transition-colors">fingerprint</span>
                                    <span class="text-white/40 font-bold uppercase tracking-widest text-xs group-hover:text-white transition-colors">Start ID Verification</span>
                                </button>
                            </div>

                            <button id="id-next-btn" onclick="window.nextWizardStep(1)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Identification Verified
                            </button>
                        </div>
                    ` : step === 2 ? `
                        <div class="flex flex-col items-center text-center">
                            <div class="w-32 h-32 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-10">
                                <span class="material-symbols-outlined text-secondary-fixed text-6xl">work</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Income Verification</h3>
                            <p class="text-white/40 mb-12 max-w-md mx-auto leading-relaxed">Securely connect your primary bank account so we can scan for recent payroll direct deposits. This allows us to instantly verify your income without needing paystubs.</p>
                            
                            <div onclick="window.initializePlaidLink(true)" id="payroll-sync-box" class="w-full max-w-sm py-12 rounded-3xl border-2 border-secondary-fixed/50 bg-secondary-fixed/10 flex flex-col items-center justify-center cursor-pointer hover:bg-secondary-fixed/20 transition-all group mb-8 shadow-[0_0_30px_rgba(211,189,115,0.15)]">
                                <span class="material-symbols-outlined text-4xl text-secondary-fixed mb-4 transition-transform group-hover:scale-110">account_balance</span>
                                <span class="text-secondary-fixed font-black uppercase tracking-widest text-xs">Connect Bank to Verify Income</span>
                            </div>

                            <div id="sync-status-container" class="hidden w-full max-w-xs">
                                <!-- Sync Processing UI will be injected here -->
                            </div>

                            <button id="wizard-next-btn" onclick="window.nextWizardStep(2)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Confirm Synced Data
                            </button>
                        </div>
                        <div class="flex flex-col items-center text-center">
                            <div class="w-32 h-32 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-10">
                                <span class="material-symbols-outlined text-secondary-fixed text-6xl">account_balance</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Down Payment & Assets</h3>
                            <p class="text-white/40 mb-8 max-w-md mx-auto leading-relaxed">Since you securely linked your bank in the previous step, we can now instantly verify your liquid account balances without needing statements.</p>
                            
                             <div id="asset-sync-box" class="w-full max-w-md p-10 rounded-3xl bg-primary border border-white/10 mb-12 text-center group hover:border-secondary-fixed transition-all duration-700">
                                <div class="w-16 h-16 rounded-full bg-secondary-fixed/10 flex items-center justify-center text-secondary-fixed mx-auto mb-6 transform group-hover:scale-110 transition-transform">
                                    <span class="material-symbols-outlined text-3xl">lock</span>
                                </div>
                                <button onclick="window.startAssetSync()" class="w-full py-5 rounded-2xl bg-secondary-fixed text-primary font-black text-sm uppercase tracking-widest hover:bg-white transition-all shadow-xl active:scale-95">
                                    Sync Live Balances Now
                                </button>
                             </div>

                            <button id="assets-next-btn" onclick="window.nextWizardStep(3)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Assets Verified
                            </button>
                        </div>
                    ` : step === 4 ? `
                        <div class="flex flex-col items-center text-center">
                            <div class="w-24 h-24 rounded-[2rem] bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-6">
                                <span class="material-symbols-outlined text-secondary-fixed text-5xl">trending_up</span>
                            </div>
                            <h3 class="text-2xl font-black text-white mb-4 uppercase tracking-tight">Credit & Background</h3>
                            <p class="text-white/40 mb-8 max-w-md mx-auto leading-relaxed text-sm">We perform a soft-pull of your credit via **Experian Sandbox**. Please enter test data.</p>
                            
                             <div id="credit-status-container" class="w-full max-w-md p-8 rounded-3xl bg-primary border border-white/10 mb-8 text-left transition-all duration-700">
                                
                                <form id="credit-pull-form" onsubmit="event.preventDefault(); window.pullCreditRecord();" class="space-y-4">
                                    <div>
                                        <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Full SSN (Sandbox Only)</label>
                                        <input id="cp-ssn" type="text" placeholder="XXX-XX-XXXX" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Date of Birth</label>
                                        <input id="cp-dob" type="date" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Street Address</label>
                                        <input id="cp-address" type="text" placeholder="123 Main St" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                    </div>
                                    <div class="grid grid-cols-3 gap-3">
                                        <div class="col-span-1">
                                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">City</label>
                                            <input id="cp-city" type="text" placeholder="Boston" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                        </div>
                                        <div class="col-span-1">
                                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">State</label>
                                            <input id="cp-state" type="text" placeholder="MA" maxlength="2" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm uppercase" required>
                                        </div>
                                        <div class="col-span-1">
                                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-2 px-1">Zip</label>
                                            <input id="cp-zip" type="text" placeholder="02108" class="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-secondary-fixed/50 transition-all font-medium text-sm" required>
                                        </div>
                                    </div>
                                    
                                    <button id="credit-pull-btn" type="submit" class="w-full mt-4 py-4 rounded-xl bg-secondary-fixed text-primary font-black text-sm uppercase tracking-widest hover:bg-white transition-all shadow-xl active:scale-95">
                                        Verify via Experian
                                    </button>
                                </form>
                             </div>

                            <button id="credit-next-btn" onclick="window.nextWizardStep(4)" class="w-full max-w-xs py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 opacity-50 cursor-not-allowed" disabled>
                                Verify & Continue To Loan Details
                            </button>
                        </div>
                    ` : step === 5 ? `
                        <div class="flex flex-col text-left">
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Property & Loan Details</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Subject Property Type</label>
                                    <select id="step5-property-type" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed transition-all font-bold">
                                        <option value="SingleFamily">Single Family Home</option>
                                        <option value="Townhouse">Townhouse</option>
                                        <option value="Condo">Condominium</option>
                                        <option value="MultiFamily">Multi-Family</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Occupancy Type</label>
                                    <select id="step5-occupancy-type" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed transition-all font-bold">
                                        <option value="PrimaryResidence">Primary Residence</option>
                                        <option value="SecondHome">Second Home</option>
                                        <option value="Investment">Investment Property</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Purchase Price</label>
                                    <input id="step5-price" type="number" value="750000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed outline-none transition-all font-bold">
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-1">Estimated Down Payment</label>
                                    <input id="step5-down" type="number" value="150000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed outline-none transition-all font-bold">
                                </div>
                            </div>
                            <button onclick="window.nextWizardStep(5)" class="w-full py-5 rounded-[2rem] bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                                Save & Continue
                            </button>
                        </div>
                    ` : step === 6 ? `
                        <div class="flex flex-col text-left">
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">2-Year Professional & Residential History</h3>
                            <p class="text-white/40 mb-10 font-bold uppercase tracking-widest text-[10px]">Brokers require 24 months of verified history for risk analysis.</p>

                            <!-- Employment -->
                            <div class="mb-12">
                                <div class="flex items-center justify-between mb-6">
                                    <span class="text-secondary-fixed font-black uppercase tracking-[0.2em] text-xs">Employment History</span>
                                    <button onclick="window.addEmploymentRow()" class="text-[10px] bg-white/5 hover:bg-white/10 text-white font-black py-2 px-4 rounded-full border border-white/10 transition-all">+ Add Employer</button>
                                </div>
                                <div id="employment-rows" class="space-y-4">
                                    <div class="employment-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                        <input type="text" placeholder="Employer Name" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-name">
                                        <input type="text" placeholder="Position/Title" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-title">
                                        <input type="date" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-start">
                                        <input type="number" placeholder="Gross Monthly Income" class="w-full bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-income">
                                    </div>
                                </div>
                            </div>

                            <!-- Residential -->
                            <div class="mb-12">
                                <div class="flex items-center justify-between mb-6">
                                    <span class="text-secondary-fixed font-black uppercase tracking-[0.2em] text-xs">Residential History</span>
                                    <button onclick="window.addResidencyRow()" class="text-[10px] bg-white/5 hover:bg-white/10 text-white font-black py-2 px-4 rounded-full border border-white/10 transition-all">+ Add Previous Address</button>
                                </div>
                                <div id="residency-rows" class="space-y-4">
                                    <div class="residency-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        <input type="text" placeholder="Full Home Address" class="lg:col-span-2 bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-address">
                                        <select class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-status">
                                            <option value="Own">Own</option>
                                            <option value="Rent">Rent</option>
                                            <option value="LivingRentFree">Living Rent Free</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <button onclick="window.nextWizardStep(6)" class="w-full py-5 rounded-[2rem] bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                                Save History & Continue
                            </button>
                        </div>
                    ` : `
                        <div class="flex flex-col text-left">
                            <h3 class="text-2xl font-black text-white mb-6 uppercase tracking-tight">Legal Declarations</h3>
                            <div class="space-y-6 mb-12">
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Are there any outstanding judgments against you?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-judgments" value="yes" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-judgments" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Have you declared bankruptcy within the past 7 years?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-bankruptcy" value="yes" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-bankruptcy" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Are you currently a party to a lawsuit?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-lawsuits" value="yes" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-lawsuits" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                                <div class="flex items-center justify-between p-6 bg-white/5 rounded-3xl border border-white/10">
                                    <span class="text-sm font-bold text-white uppercase tracking-tight w-2/3">Are you a Canadian Citizen or Permanent Resident?</span>
                                    <div class="flex space-x-6 w-1/3 justify-end leading-none">
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-citizen" value="yes" checked class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer" required><span class="text-sm font-bold text-white">Yes</span></label>
                                        <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="decl-citizen" value="no" class="w-5 h-5 text-secondary-fixed bg-primary border-white/20 focus:ring-secondary-fixed focus:ring-offset-primary cursor-pointer"><span class="text-sm font-bold text-white">No</span></label>
                                    </div>
                                </div>
                            </div>
                            
                            <button id="final-submit-btn" onclick="window.nextWizardStep(7)" class="w-full py-6 rounded-[2rem] bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.05] transition-all shadow-2xl active:scale-95">
                                Complete & Submit Official Application
                            </button>
                        </div>
                    `}
                </div>

                <button onclick="window.togglePortal(true)" class="mt-12 w-full text-center text-white/20 hover:text-white transition-colors uppercase font-black tracking-widest text-xs">
                    Cancel & Return to Dashboard
                </button>
            </div>
        </section>
    `;
}

function renderLogin() {
    return `
        <section class="min-h-screen flex items-center justify-center pt-24 pb-12 relative overflow-hidden" style="background: radial-gradient(ellipse 120% 80% at 50% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
            <!-- Animated Wave Background -->
            <div class="absolute inset-0 z-0">
                <svg id="auth-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.25; filter: drop-shadow(0 0 8px rgba(211,189,115,0.3));"></svg>
                <div class="absolute inset-0" style="background: radial-gradient(ellipse at 50% 50%, rgba(211,189,115,0.04) 0%, transparent 70%);"></div>
            </div>

            <div class="max-w-md w-full px-6 relative z-10 reveal reveal-up">
                <div class="p-10 md:p-12 rounded-[3.5rem] glass-card border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-3xl bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-8 mx-auto">
                        <span class="material-symbols-outlined text-secondary-fixed text-4xl">lock</span>
                    </div>
                    <h2 class="text-3xl font-black text-white mb-2 uppercase tracking-tight">Secure Access</h2>
                    <p class="text-white/40 text-sm mb-10 font-bold uppercase tracking-[0.2em]">MajesticEquity Portal</p>

                    <div id="login-error" class="text-red-400 text-xs font-bold uppercase tracking-widest mb-4"></div>

                    <div class="space-y-6 text-left">
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Email Address</label>
                            <input id="login-email" type="email" placeholder="client@example.com" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Password</label>
                            <input id="login-password" type="password" placeholder="••••••••" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium" onkeydown="if(event.key==='Enter') window.submitLogin()">
                        </div>
                        <button id="login-btn" onclick="window.submitLogin()" class="w-full py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 mt-4">
                            Log In & Authenticate
                        </button>
                    </div>
                    
                    <div class="mt-8 flex flex-col gap-4">
                        <button onclick="window.showRegister()" class="text-secondary-fixed text-xs font-bold uppercase tracking-widest hover:underline">Create New Account</button>
                        <div class="h-px bg-white/5 w-full my-1"></div>
                        <button onclick="window.showAgentSignup()" class="text-white/60 text-[10px] font-black uppercase tracking-widest hover:text-secondary-fixed transition-colors italic">Are you a Mortgage Agent? Join our Expert Network</button>
                        <button onclick="window.showLandingPage()" class="text-white/40 text-[10px] font-bold hover:text-white transition-colors uppercase tracking-[0.1em]">
                            Cancel & Return to Home
                        </button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderRegister() {
    return `
        <section class="min-h-screen flex items-center justify-center pt-24 pb-12 relative overflow-hidden" style="background: radial-gradient(ellipse 120% 80% at 50% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
            <!-- Animated Wave Background -->
            <div class="absolute inset-0 z-0">
                <svg id="auth-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.25; filter: drop-shadow(0 0 8px rgba(211,189,115,0.3));"></svg>
                <div class="absolute inset-0" style="background: radial-gradient(ellipse at 50% 50%, rgba(211,189,115,0.04) 0%, transparent 70%);"></div>
            </div>

            <div class="max-w-md w-full px-6 relative z-10 reveal reveal-up">
                <div class="p-10 md:p-12 rounded-[3.5rem] glass-card border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-3xl bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-8 mx-auto">
                        <span class="material-symbols-outlined text-secondary-fixed text-4xl">person_add</span>
                    </div>
                    <h2 class="text-3xl font-black text-white mb-2 uppercase tracking-tight">New Application</h2>
                    <p class="text-white/40 text-sm mb-10 font-bold uppercase tracking-[0.2em]">MajesticEquity Portal</p>
                    ${window.pendingInviteContext && !window.pendingInviteContext.error ? `
                        <div class="mb-8 p-4 rounded-2xl bg-secondary-fixed/10 border border-secondary-fixed/20 text-left">
                            <div class="text-[10px] font-black uppercase tracking-widest text-secondary-fixed mb-2">Verified Agent Invitation</div>
                            <div class="text-white font-bold">${window.pendingInviteContext.agent.name}</div>
                            <div class="text-white/50 text-xs mt-1">${window.pendingInviteContext.agent.brokerageName} • ${window.pendingInviteContext.agent.licenseClass}</div>
                        </div>
                    ` : ''}
                    ${window.pendingInviteContext?.error ? `<div class="mb-8 p-4 rounded-2xl bg-red-500/10 text-red-300 text-xs font-bold uppercase tracking-widest">${window.pendingInviteContext.error}</div>` : ''}

                    <div id="register-error" class="text-red-400 text-xs font-bold uppercase tracking-widest mb-4"></div>

                    <div class="space-y-6 text-left">
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Full Name</label>
                            <input id="register-name" type="text" placeholder="John Smith" value="${window.pendingInviteContext?.borrowerName || ''}" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Email Address</label>
                            <input id="register-email" type="email" placeholder="your@email.com" value="${window.pendingInviteContext?.borrowerEmail || ''}" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Phone Number</label>
                            <input id="register-phone" type="tel" placeholder="(555) 000-0000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Create Password</label>
                            <input id="register-password" type="password" placeholder="Min 6 characters" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium" onkeydown="if(event.key==='Enter') window.submitRegister()">
                        </div>
                        <button id="register-btn" onclick="window.submitRegister()" class="w-full py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 mt-4">
                            Create Secure Account
                        </button>
                    </div>
                    
                    <div class="mt-8 flex flex-col gap-4">
                        <button onclick="window.showLogin()" class="text-secondary-fixed text-xs font-bold uppercase tracking-widest hover:underline">Already Have an Account? Log In</button>
                        <div class="h-px bg-white/5 w-full my-1"></div>
                        <button onclick="window.showAgentSignup()" class="text-white/60 text-[10px] font-black uppercase tracking-widest hover:text-secondary-fixed transition-colors italic">Mortgage Professional? Register as an Agent</button>
                        <button onclick="window.showLandingPage()" class="text-white/40 text-[10px] font-bold hover:text-white transition-colors uppercase tracking-[0.1em]">
                            Cancel & Return to Home
                        </button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.showAgentSignup = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderAgentSignup();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.initWaveAnimation('auth-wave-svg');
}

function renderAgentSignup() {
    return `
        <section class="min-h-screen flex items-center justify-center pt-24 pb-12 relative overflow-hidden" style="background: radial-gradient(ellipse 120% 80% at 50% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
            <!-- Animated Wave Background -->
            <div class="absolute inset-0 z-0">
                <svg id="auth-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.25; filter: drop-shadow(0 0 8px rgba(211,189,115,0.3));"></svg>
                <div class="absolute inset-0" style="background: radial-gradient(ellipse at 50% 50%, rgba(211,189,115,0.04) 0%, transparent 70%);"></div>
            </div>

            <div class="max-w-xl w-full px-6 relative z-10 reveal reveal-up">
                <div class="p-10 md:p-12 rounded-[3.5rem] glass-card border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-3xl bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mb-8 mx-auto">
                        <span class="material-symbols-outlined text-secondary-fixed text-4xl">domain_verification</span>
                    </div>
                    <h2 class="text-3xl font-black text-white mb-2 uppercase tracking-tight">Expert Network Application</h2>
                    <p class="text-white/40 text-sm mb-10 font-bold uppercase tracking-[0.2em]">Join MajesticEquity as an Agent</p>

                    <div id="agent-register-error" class="text-red-400 text-xs font-bold uppercase tracking-widest mb-4"></div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                        <div class="md:col-span-2">
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Professional Name</label>
                             <input id="agent-name" type="text" placeholder="John Smith, CMC" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Work Email</label>
                             <input id="agent-email" type="email" placeholder="john@brokerage.com" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Mobile Number</label>
                             <input id="agent-phone" type="tel" placeholder="(555) 000-0000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">FSRA Licence #</label>
                             <input id="agent-license-number" type="text" placeholder="M08001234" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div>
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Ontario Licence Class</label>
                             <select id="agent-license-class" class="w-full bg-primary border border-white/10 rounded-2xl py-4 px-6 text-white focus:border-secondary-fixed/50 outline-none transition-all font-medium appearance-none">
                                <option value="" disabled selected>Select Class</option>
                                <option value="Mortgage Agent Level 1">Mortgage Agent Level 1</option>
                                <option value="Mortgage Agent Level 2">Mortgage Agent Level 2</option>
                                <option value="Mortgage Broker">Mortgage Broker</option>
                                <option value="Principal Broker">Principal Broker</option>
                             </select>
                        </div>
                        <div class="md:col-span-2">
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Brokerage Name</label>
                             <input id="agent-brokerage" type="text" placeholder="Majestic Equity Partners / Independent" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div class="md:col-span-2">
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Brokerage Licence #</label>
                             <input id="agent-brokerage-license" type="text" placeholder="Required for automated match" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div class="md:col-span-2">
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">FSRA Registry Profile URL</label>
                             <input id="agent-registry-url" type="url" placeholder="https://www2.fsco.gov.on.ca/..." class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        <div class="md:col-span-2">
                             <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-widest mb-3 px-2">Create Secure Password</label>
                             <input id="agent-password" type="password" placeholder="Min 8 characters" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder:text-white/20 focus:border-secondary-fixed/50 outline-none transition-all font-medium">
                        </div>
                        
                        <button id="agent-register-btn" onclick="window.submitAgentRegister()" class="md:col-span-2 w-full py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95 mt-4">
                            Submit Expert Application
                        </button>
                    </div>
                    
                    <div class="mt-8 flex flex-col gap-4 border-t border-white/5 pt-8">
                        <button onclick="window.showLogin()" class="text-secondary-fixed text-xs font-bold uppercase tracking-widest hover:underline">Already an Expert? Log In Here</button>
                        <button onclick="window.showLandingPage()" class="text-white/40 text-[10px] font-bold hover:text-white transition-colors uppercase tracking-[0.1em]">
                            Cancel & Return to Home
                        </button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.submitAgentRegister = async function() {
    const name = document.getElementById('agent-name').value;
    const email = document.getElementById('agent-email').value;
    const phone = document.getElementById('agent-phone').value;
    const licenseNumber = document.getElementById('agent-license-number').value;
    const licenseClass = document.getElementById('agent-license-class').value;
    const brokerageName = document.getElementById('agent-brokerage').value;
    const brokerageLicenseNumber = document.getElementById('agent-brokerage-license').value;
    const registryProfileUrl = document.getElementById('agent-registry-url').value;
    const password = document.getElementById('agent-password').value;
    const errorEl = document.getElementById('agent-register-error');
    const btn = document.getElementById('agent-register-btn');

    if (!name || !email || !phone || !password || !licenseNumber || !licenseClass || !brokerageName || !brokerageLicenseNumber || !registryProfileUrl) {
        errorEl.textContent = 'All identity, FSRA, brokerage, registry URL, and password fields are required.';
        return;
    }

    if (!registryProfileUrl.startsWith('https://www.fsrao.ca/') && !registryProfileUrl.startsWith('https://www2.fsco.gov.on.ca/') && !registryProfileUrl.startsWith('https://mbsweblist.fsco.gov.on.ca/')) {
        errorEl.textContent = 'Registry URL must be an official FSRA or FSCO HTTPS page.';
        return;
    }

    btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">progress_activity</span> Processing Application...';

    try {
        const res = await fetch('/api/auth/register-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, password, licenseNumber, licenseClass, brokerageName, brokerageLicenseNumber, registryProfileUrl })
        });
        const data = await res.json();
        
        if (data.success) {
            window.mfaContext = { email: data.email };
            document.getElementById('app-content').innerHTML = renderRegistrationVerification(data.email);
            window.initWaveAnimation('portal-wave-svg');
        } else {
            errorEl.textContent = data.error || 'Registration failed.';
            btn.textContent = 'Submit Expert Application';
        }
    } catch (e) {
        errorEl.textContent = 'Professional registration service unavailable.';
        btn.textContent = 'Submit Expert Application';
    }
}


function renderMFAChallenge(type) {
    return `
        <section class="min-h-screen bg-primary flex items-center justify-center relative overflow-hidden">
            <!-- Animated Wave Mesh Background -->
            <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                <!-- JS-animated wave canvas -->
                <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.22;"></svg>
                <!-- Radial glow accent in top-right -->
                <div class="absolute top-0 right-0 w-[70%] h-[70%]" style="background: radial-gradient(ellipse at 80% 30%, rgba(211,189,115,0.06) 0%, transparent 60%);"></div>
            </div>
            <div class="max-w-md w-full p-8 relative z-10">
                <div class="glass-card p-10 rounded-[3.5rem] border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-full bg-secondary-fixed/20 flex items-center justify-center mx-auto mb-8">
                        <span class="material-symbols-outlined text-4xl text-secondary-fixed">${type === 'totp' ? 'verified_user' : 'mark_email_read'}</span>
                    </div>
                    <h2 class="text-3xl font-black text-white uppercase tracking-tight mb-4">Two-Step Verification</h2>
                    <p class="text-white/60 mb-8 font-medium">
                        ${type === 'totp' ? 'Open your <strong>Google Authenticator</strong> app and enter the 6-digit code.' : 'We\'ve sent a 6-digit verification code to your email.'}
                    </p>
                    
                    <div class="space-y-6">
                        <input id="mfa-code" type="text" maxlength="6" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-5 text-center text-3xl font-black text-secondary-fixed placeholder:text-white/10 tracking-[0.5em] outline-none focus:border-secondary-fixed/50 transition-all" autofocus>
                        <div id="mfa-error" class="text-red-400 text-xs font-bold uppercase tracking-widest h-4"></div>
                        <button onclick="window.submitMFA()" class="w-full py-5 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                            Verify & Log In
                        </button>
                        <button onclick="window.showLogin()" class="text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Cancel</button>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderRegistrationVerification(email) {
    return `
        <section class="min-h-screen bg-primary flex items-center justify-center relative overflow-hidden">
            <!-- Animated Wave Mesh Background -->
            <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                <!-- JS-animated wave canvas -->
                <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.22;"></svg>
                <!-- Radial glow accent in top-right -->
                <div class="absolute top-0 right-0 w-[70%] h-[70%]" style="background: radial-gradient(ellipse at 80% 30%, rgba(211,189,115,0.06) 0%, transparent 60%);"></div>
            </div>
            <div class="max-w-2xl w-full p-8 relative z-10">
                <div class="glass-card p-12 rounded-[4rem] border-white/10 shadow-2xl text-center">
                    <div class="w-20 h-20 rounded-full bg-secondary-fixed/20 flex items-center justify-center mx-auto mb-8">
                        <span class="material-symbols-outlined text-4xl text-secondary-fixed">verified_user</span>
                    </div>
                    <h2 class="text-3xl font-black text-white uppercase tracking-tight mb-4">Verification Required</h2>
                    <p class="text-white/60 mb-12 font-medium max-w-md mx-auto line-tight">
                        To protect your identity, we've sent unique verification codes to both your email and phone.
                    </p>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                        <div class="space-y-4">
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                                <span class="material-symbols-outlined">mail</span> Email Code
                            </label>
                            <input id="verify-email-code" type="text" maxlength="6" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-5 text-center text-2xl font-black text-white placeholder:text-white/10 tracking-[0.3em] outline-none focus:border-secondary-fixed transition-all">
                        </div>
                        <div class="space-y-4">
                            <label class="block text-[10px] font-black text-secondary-fixed uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                                <span class="material-symbols-outlined">phone_iphone</span> SMS Code
                            </label>
                            <input id="verify-phone-code" type="text" maxlength="6" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-5 text-center text-2xl font-black text-white placeholder:text-white/10 tracking-[0.3em] outline-none focus:border-secondary-fixed transition-all">
                        </div>
                    </div>

                    <div id="verify-reg-error" class="text-red-400 text-xs font-bold uppercase tracking-widest h-4 my-8"></div>
                    
                    <div class="flex flex-col gap-4">
                        <button onclick="window.submitRegistrationVerification()" class="w-full py-6 rounded-3xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-sm hover:scale-[1.02] transition-all shadow-xl active:scale-95">
                            Complete Verification
                        </button>
                        <div class="flex items-center justify-between px-4 mt-4">
                             <button onclick="window.resendRegistrationVerification()" class="text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Resend Codes</button>
                             <button onclick="window.showLogin()" class="text-white/30 text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.submitRegistrationVerification = async function() {
    const emailCode = document.getElementById('verify-email-code').value;
    const phoneCode = document.getElementById('verify-phone-code').value;
    const errorEl = document.getElementById('verify-reg-error');
    
    if (!emailCode || !phoneCode) {
        errorEl.textContent = 'Both codes are required.';
        return;
    }

    try {
        const res = await fetch('/api/auth/verify-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: window.mfaContext.email, emailCode, phoneCode })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            await window.checkUserStatus();
            window.togglePortal(true);
        } else {
            errorEl.textContent = data.error || 'Verification failed.';
        }
    } catch (e) {
        errorEl.textContent = 'Verification service unavailable.';
    }
}

window.resendRegistrationVerification = async function() {
    try {
        const res = await fetch('/api/auth/resend-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: window.mfaContext.email })
        });
        const data = await res.json();
        if (data.success) {
            alert('Verification codes resent!');
        }
    } catch (e) { console.error(e); }
}

window.submitMFA = async function() {
    const code = document.getElementById('mfa-code').value;
    const errorEl = document.getElementById('mfa-error');
    if (!code || code.length < 6) return;

    try {
        const res = await fetch('/api/auth/mfa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: window.mfaContext.email, code })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('jwt_token', data.token);
            localStorage.setItem('user_data', JSON.stringify(data.user));
            await window.checkUserStatus();
            window.togglePortal(true);
        } else {
            errorEl.textContent = data.error || 'Invalid code';
        }
    } catch (e) {
        errorEl.textContent = 'Verification service unavailable.';
    }
}

window.showSecurity = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderSecuritySettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
    window.loadSecurityData();
    window.initWaveAnimation('portal-wave-svg');
}

function renderSecuritySettings() {
    return `
        <section class="min-h-screen bg-primary pt-32 pb-24 relative overflow-hidden">
            <!-- Animated Wave Mesh Background -->
            <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                <!-- JS-animated wave canvas -->
                <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.22;"></svg>
                <!-- Radial glow accent in top-right -->
                <div class="absolute top-0 right-0 w-[70%] h-[70%]" style="background: radial-gradient(ellipse at 80% 30%, rgba(211,189,115,0.06) 0%, transparent 60%);"></div>
            </div>
            <div class="max-w-4xl mx-auto px-4 relative z-10">
                <div class="flex items-center justify-between mb-12">
                    <button onclick="window.togglePortal(true)" class="flex items-center gap-2 text-white/40 hover:text-white transition-all font-bold uppercase tracking-widest text-xs">
                        <span class="material-symbols-outlined">chevron_left</span> Back to Dashboard
                    </button>
                    <h2 class="text-3xl font-black text-white uppercase tracking-tight">Account <span class="text-secondary-fixed">Security</span></h2>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <!-- Method 1: Email -->
                    <div class="glass-card p-10 rounded-[3rem] border-white/10 hover:border-secondary-fixed/20 transition-all group">
                        <div class="w-16 h-16 rounded-2xl bg-secondary-fixed/10 flex items-center justify-center text-secondary-fixed mb-8 group-hover:scale-110 transition-transform">
                            <span class="material-symbols-outlined text-3xl">mail</span>
                        </div>
                        <h3 class="text-xl font-black text-white uppercase mb-2">Email Verification</h3>
                        <p class="text-white/40 text-sm mb-8 leading-relaxed">Receive a 6-digit code in your inbox for every login attempt.</p>
                        <div id="email-mfa-status">
                             <button onclick="window.enableMFA('email')" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Enable Email MFA</button>
                        </div>
                    </div>

                    <!-- Method 2: Authenticator -->
                    <div class="glass-card p-10 rounded-[3rem] border-white/10 hover:border-secondary-fixed/20 transition-all group">
                        <div class="w-16 h-16 rounded-2xl bg-secondary-fixed/10 flex items-center justify-center text-secondary-fixed mb-8 group-hover:scale-110 transition-transform">
                            <span class="material-symbols-outlined text-3xl">verified_user</span>
                        </div>
                        <h3 class="text-xl font-black text-white uppercase mb-2">Authenticator App</h3>
                        <p class="text-white/40 text-sm mb-8 leading-relaxed">Use apps like Google Authenticator or Authy to generate secure codes.</p>
                        <div id="totp-mfa-status">
                            <button onclick="window.setupTOTP()" class="w-full py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs hover:bg-white transition-all">Setup Authenticator</button>
                        </div>
                    </div>
                </div>

                <!-- TOTP Setup Modal (Hidden by default) -->
                <div id="totp-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-primary/90 backdrop-blur-sm p-4">
                    <div class="glass-card p-10 rounded-[3.5rem] border-white/20 shadow-2xl max-w-md w-full text-center">
                        <h3 class="text-2xl font-black text-white uppercase tracking-tight mb-6">Setup Authenticator</h3>
                        <div id="qr-container" class="bg-white p-4 rounded-3xl inline-block mb-8 shadow-inner overflow-hidden">
                            <div class="w-48 h-48 bg-gray-100 flex items-center justify-center">
                                <span class="material-symbols-outlined animate-spin text-2xl text-primary">progress_activity</span>
                            </div>
                        </div>
                        <p class="text-white/60 text-sm mb-8">Scan this QR code with your Authenticator app, then enter the 6-digit code below to confirm.</p>
                        <input id="totp-setup-code" type="text" placeholder="000000" class="w-full bg-white/5 border border-white/10 rounded-2xl py-4 text-center text-xl font-bold text-secondary-fixed mb-6 outline-none">
                        <div class="flex gap-4">
                            <button onclick="document.getElementById('totp-modal').classList.add('hidden')" class="flex-1 py-4 text-white/40 font-bold uppercase tracking-widest text-xs">Cancel</button>
                            <button onclick="window.verifyTOTP()" class="flex-1 py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs">Verify & Enable</button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.loadSecurityData = async function() {
    // We already have userStatus from checkUserStatus
    const user = window.userStatus;
    if (!user) return;

    const emailStatus = document.getElementById('email-mfa-status');
    const totpStatus = document.getElementById('totp-mfa-status');

    if (!user.mfaEnabled) {
        emailStatus.innerHTML = `<button onclick="window.enableMFA('email')" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Enable Email MFA</button>`;
        totpStatus.innerHTML = `<button onclick="window.setupTOTP()" class="w-full py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs hover:bg-white transition-all">Setup Authenticator</button>`;
        return;
    }

    if (user.mfaType === 'email') {
        emailStatus.innerHTML = `<div class="flex items-center gap-2 text-green-400 font-black text-xs uppercase"><span class="material-symbols-outlined text-lg">check_circle</span> Active</div>
                                  <button onclick="window.disableMFA()" class="mt-4 text-white/20 hover:text-red-400 text-[10px] font-black uppercase underline">Disable</button>`;
        totpStatus.innerHTML = `<button onclick="window.setupTOTP()" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Switch to App</button>`;
    } else if (user.mfaType === 'totp') {
        totpStatus.innerHTML = `<div class="flex items-center gap-2 text-green-400 font-black text-xs uppercase"><span class="material-symbols-outlined text-lg">check_circle</span> Active</div>
                                 <button onclick="window.disableMFA()" class="mt-4 text-white/20 hover:text-red-400 text-[10px] font-black uppercase underline">Disable</button>`;
        emailStatus.innerHTML = `<button onclick="window.enableMFA('email')" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest text-xs hover:bg-secondary-fixed hover:text-primary transition-all">Switch to Email</button>`;
    }
}

window.enableMFA = async function(type) {
    try {
        const res = await authFetch('/api/auth/mfa/enable', {
            method: 'POST',
            body: JSON.stringify({ type })
        });
        const data = await res.json();
        if (data.success) {
            await window.checkUserStatus();
            window.loadSecurityData();
        }
    } catch (e) { console.error(e); }
}

window.disableMFA = async function() {
    if (!confirm('Disabling MFA will make your account less secure. Continue?')) return;
    try {
        await authFetch('/api/auth/mfa/disable', { method: 'POST' });
        await window.checkUserStatus();
        window.loadSecurityData();
    } catch (e) { console.error(e); }
}

window.setupTOTP = async function() {
    const modal = document.getElementById('totp-modal');
    const qrContainer = document.getElementById('qr-container');
    modal.classList.remove('hidden');

    try {
        const res = await authFetch('/api/auth/mfa/setup', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            qrContainer.innerHTML = `<img src="${data.qrCode}" alt="QR Code" class="w-full h-full" loading="lazy">`;
        }
    } catch (e) { console.error(e); }
}

window.verifyTOTP = async function() {
    const code = document.getElementById('totp-setup-code').value;
    if (!code) return;

    try {
        const res = await authFetch('/api/auth/mfa/enable', {
            method: 'POST',
            body: JSON.stringify({ type: 'totp', code })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('totp-modal').classList.add('hidden');
            await window.checkUserStatus();
            window.loadSecurityData();
        } else {
            alert(data.error || 'Invalid code');
        }
    } catch (e) { console.error(e); }
}

window.focusedStepOverride = null;
window.setFocusStep = function(stepIdx) {
    window.focusedStepOverride = stepIdx;
    const main = document.querySelector('main');
    if (main) main.innerHTML = renderPortal();
};

function renderPortal() {
    const appStatus = window.userStatus?.application;
    const loanCompleted = !!appStatus && appStatus.status !== 'Draft';
    const completedSteps = window.userStatus?.completedSteps || 0;
    const progressPercent = window.userStatus?.progressPercent || 0;

    const idDone = appStatus?.identityVerified || (window.userStatus?.identityStatus === 'completed' || window.userStatus?.identityStatus === 'Verified');
    const incomeDone = appStatus?.incomeVerified || false;
    const assetsDone = appStatus?.assetsVerified || false;
    const creditDone = appStatus?.creditVerified || false;
    const submitted = loanCompleted;

    const step1Unlocked = true;
    const step2Unlocked = idDone;
    const step3Unlocked = idDone && incomeDone;
    const step4Unlocked = idDone && incomeDone && assetsDone;

    let focusedStep = window.focusedStepOverride !== null ? window.focusedStepOverride : completedSteps;
    if (focusedStep > 4) focusedStep = 4;

    const currentStatus = appStatus?.status || 'Draft';
    const userName = window.userStatus?.name || window.userStatus?.email || 'Borrower';

    // SVG ring math
    const ringRadius = 115;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference - (ringCircumference * progressPercent / 100);

    // Step card definitions
    const verificationCards = [
        { title: 'Verify ID', icon: 'fingerprint', desc: 'Government-issued document verification.', done: idDone, unlocked: step1Unlocked, wizardIdx: 1, btnLabel: 'Start Now', doneLabel: 'Verified' },
        { title: 'Payroll Sync', icon: 'account_balance_wallet', desc: 'Connect to your employer portal securely.', done: incomeDone, unlocked: step2Unlocked, wizardIdx: 2, btnLabel: 'Start Now', doneLabel: 'Synced' },
        { title: 'Link Bank', icon: 'account_balance', desc: 'Verify income and monthly assets.', done: assetsDone, unlocked: step3Unlocked, wizardIdx: 3, btnLabel: 'Start Now', doneLabel: 'Linked' },
        { title: 'Credit Check', icon: 'speed', desc: 'Pull official credit scores for rate locks.', done: creditDone, unlocked: step4Unlocked, wizardIdx: 4, btnLabel: 'Start Now', doneLabel: 'Pulled' }
    ];

    function renderVerificationCard(card, idx) {
        const isActive = !card.done && card.unlocked;
        const isLocked = !card.done && !card.unlocked;
        const isFocused = idx === focusedStep;

        if (card.done) {
            return `
            <div class="glass-card p-8 rounded-2xl border border-green-500/30 bg-green-500/5 transition-all group">
                <div class="w-12 h-12 rounded-xl bg-green-500/20 border border-green-500/30 flex items-center justify-center mb-6">
                    <span class="material-symbols-outlined text-green-400">check_circle</span>
                </div>
                <h3 class="font-headline font-bold text-lg text-white mb-2">${card.title}</h3>
                <p class="text-green-400/80 text-sm mb-8 leading-relaxed">${card.doneLabel} successfully.</p>
                <button onclick="window.startWizard(${card.wizardIdx})" class="w-full py-3 border border-green-500/30 text-green-400 text-xs font-headline font-bold uppercase tracking-widest rounded-lg hover:bg-green-500/10 transition-all">Review</button>
            </div>`;
        }
        if (isLocked) {
            return `
            <div class="glass-card p-8 rounded-2xl border border-white/5 opacity-60 transition-all">
                <div class="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6">
                    <span class="material-symbols-outlined text-white/40">${card.icon}</span>
                </div>
                <h3 class="font-headline font-bold text-lg text-white/60 mb-2">${card.title}</h3>
                <p class="text-on-primary-container text-sm mb-8 leading-relaxed">${card.desc}</p>
                <button class="w-full py-3 border border-white/10 text-white/30 text-xs font-headline font-bold uppercase tracking-widest rounded-lg cursor-not-allowed">Locked</button>
            </div>`;
        }
        // Active / unlocked
        return `
        <div class="glass-card p-8 rounded-2xl border ${isFocused ? 'border-secondary-fixed/30' : 'border-white/10'} hover:bg-white/5 transition-all group">
            <div class="w-12 h-12 rounded-xl ${isFocused ? 'bg-secondary-container border border-secondary/20' : 'bg-white/5 border border-white/10'} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <span class="material-symbols-outlined ${isFocused ? 'text-secondary-fixed' : 'text-white/60'}">${card.icon}</span>
            </div>
            <h3 class="font-headline font-bold text-lg text-white mb-2">${card.title}</h3>
            <p class="text-on-primary-container text-sm mb-4 leading-relaxed">${card.desc}</p>
            <button onclick="window.startWizard(${card.wizardIdx})" class="w-full py-3 bg-secondary-fixed text-primary text-xs font-headline font-extrabold uppercase tracking-widest rounded-lg transition-all hover:brightness-110 active:scale-95 shadow-lg shadow-secondary/10 mb-2">${card.btnLabel}</button>
            ${idx < 4 ? `<button onclick="window.setFocusStep(${idx + 1})" class="w-full py-2 text-white/40 text-xs font-headline font-bold uppercase tracking-widest hover:text-white/70 transition-colors">Skip for now</button>` : ''}
        </div>`;
    }

    // Progress description text
    let progressDescription = '';
    if (submitted) {
        progressDescription = `Your application is officially <strong>${currentStatus}</strong>. Your broker will reach out soon.`;
    } else if (completedSteps === 0) {
        progressDescription = "You are at the starting line. Complete your identity verification to unlock your personalized loan terms and dedicated support.";
    } else {
        progressDescription = `${completedSteps} of 5 milestones completed. Keep going to unlock your best rates.`;
    }

    // Pending doc count
    const pendingDocs = 4 - completedSteps;

    return `
    <section class="min-h-screen pt-28 relative overflow-hidden bg-primary">
        <!-- Animated Wave Mesh Background -->
        <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
            <!-- JS-animated wave canvas -->
            <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.22;"></svg>
            <!-- Radial glow accent in top-right -->
            <div class="absolute top-0 right-0 w-[70%] h-[70%]" style="background: radial-gradient(ellipse at 80% 30%, rgba(211,189,115,0.06) 0%, transparent 60%);"></div>
        </div>

        <!-- Main Editorial Application Container -->
        <div class="relative z-10 w-full max-w-7xl mx-auto px-6 py-12">
            <div class="glass-card rounded-[2rem] border border-secondary-fixed/20 p-8 md:p-16 shadow-2xl">

                <!-- Hero Section: 12-col Grid -->
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center mb-16">
                    <!-- Left: 7 cols -->
                    <div class="lg:col-span-7">
                        <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary-container border border-secondary/30 text-secondary-fixed text-xs font-headline font-bold uppercase tracking-[0.2em] mb-6">
                            <span class="w-1.5 h-1.5 rounded-full bg-secondary-fixed animate-pulse"></span>
                            ${submitted ? currentStatus : 'Welcome back, ' + userName}
                        </span>
                        <h1 class="text-white font-headline text-5xl md:text-7xl font-extrabold tracking-tighter mb-8 leading-[1.05]">
                            My Home <br/><span class="text-secondary-fixed">Journey</span>
                        </h1>
                        <!-- Glass Progress Card -->
                        <div class="glass-card p-8 rounded-2xl border border-white/10 max-w-xl">
                            <div class="flex justify-between items-end mb-4">
                                <span class="text-white font-headline font-bold text-lg">Application Phase</span>
                                <span class="text-secondary-fixed font-headline font-black text-2xl">${progressPercent}%</span>
                            </div>
                            <div class="h-[2px] w-full bg-white/10 rounded-full overflow-hidden">
                                <div class="h-full bg-gradient-to-r from-secondary to-secondary-fixed shadow-[0_0_15px_rgba(211,189,115,0.5)] transition-all duration-1000" style="width: ${Math.max(progressPercent, 2)}%;"></div>
                            </div>
                            <p class="mt-6 text-on-primary-container text-sm font-body leading-relaxed">${progressDescription}</p>
                        </div>
                    </div>
                    <!-- Right: 5 cols -->
                    <div class="lg:col-span-5 flex flex-col gap-8 items-end">
                        <!-- Circular Progress Ring -->
                        <div class="relative w-64 h-64 flex items-center justify-center">
                            <svg class="absolute inset-0 w-full h-full -rotate-90">
                                <circle cx="50%" cy="50%" r="45%" fill="transparent" stroke="rgba(255,255,255,0.05)" stroke-width="2"></circle>
                                <circle cx="50%" cy="50%" r="45%" fill="transparent" stroke="#D3BD73" stroke-dasharray="${ringCircumference}" stroke-dashoffset="${ringOffset}" stroke-linecap="round" stroke-width="3" class="transition-all duration-1000 shadow-[0_0_15px_rgba(211,189,115,0.3)]"></circle>
                            </svg>
                            <div class="text-center">
                                <span class="text-white font-headline text-5xl font-black">${window.userStatus?.creditScore || progressPercent + '%'}</span>
                                <p class="text-on-primary-container font-headline text-[10px] uppercase tracking-widest mt-1">${window.userStatus?.creditScore ? 'Credit Score' : 'Completion'}</p>
                            </div>
                        </div>
                        <!-- Expert Card -->
                        <div class="glass-card p-6 rounded-2xl flex items-center gap-5 w-full max-w-sm border-l-4 border-secondary-fixed shadow-xl">
                            <div class="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                                <img alt="Juthi Akhy" class="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAUxHMTMwNAf5KXFYgZYocChf_-f-djms8_5bL5fORGPzf3Ka_JTPi2Ay2BBTXM3lWf8kjTUbbL5uZO2KN3EhlpWLnHwEIpiPDohqgDHBD38PpFEH3LWI-V8wpPTV4A1S3vmOud_VIfykxmowpCDEVTA0RmdFZHz_NgwKPvTZrq90HqcCWisZjNxqgEe-bHa_PI1kCwuHzc3cigtKTp1KNRIQwoHpDgd07vhyBYSDy0MP5sqnBteG0iF9f9bDBmEtTKkATsW5uQ6_nG"/>
                            </div>
                            <div>
                                <h4 class="text-white font-headline font-bold text-lg">Juthi Akhy</h4>
                                <p class="text-secondary-fixed text-xs font-headline font-bold uppercase tracking-wider">Your Lead Expert</p>
                                <div class="mt-3 flex gap-4">
                                    <button onclick="${appStatus && submitted ? "document.getElementById('chat-input')?.focus(); document.getElementById('chat-messages')?.scrollIntoView({behavior:'smooth'})" : "alert('Submit your application first to unlock messaging.')"}" class="text-white/60 hover:text-secondary-fixed transition-colors">
                                        <span class="material-symbols-outlined text-xl">chat</span>
                                    </button>
                                    <button class="text-white/60 hover:text-secondary-fixed transition-colors">
                                        <span class="material-symbols-outlined text-xl">call</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Active Verifications: The Tonal Grid -->
                <div class="mb-16">
                    <h2 class="font-headline text-2xl font-extrabold text-white mb-8 tracking-tight">Active Verifications</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        ${verificationCards.map((c, i) => renderVerificationCard(c, i)).join('')}
                    </div>
                </div>

                ${appStatus && submitted ? `
                <!-- Borrower Chat Box -->
                <div class="mb-16 pt-8 border-t border-white/5">
                    <h2 class="font-headline text-2xl font-extrabold text-white mb-8 tracking-tight">Messages with Broker</h2>
                    <div id="chat-messages" class="h-64 overflow-y-auto mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                        <p class="text-white/40 text-sm italic text-center"><span class="material-symbols-outlined animate-spin">progress_activity</span> Loading messages...</p>
                    </div>
                    <form onsubmit="window.sendMessage(event, '${appStatus._id}')" class="flex gap-4">
                        <input type="text" id="chat-input" placeholder="Type a message to your broker..." class="flex-1 bg-white/5 border border-white/20 rounded-full text-white px-6 py-3 outline-none focus:border-secondary-fixed transition-colors font-body" required>
                        <button type="submit" id="chat-send-btn" class="w-12 h-12 rounded-full bg-secondary-fixed text-primary flex items-center justify-center hover:brightness-110 transition-all">
                            <span class="material-symbols-outlined">send</span>
                        </button>
                    </form>
                </div>
                ` : ''}

                <!-- Document Center -->
                <div class="pt-8 border-t border-white/5">
                    <div class="flex flex-col md:flex-row justify-between items-baseline mb-10">
                        <h2 class="font-headline text-2xl font-extrabold text-white tracking-tight">Document Center</h2>
                        <span class="text-secondary-fixed text-xs font-headline font-bold uppercase tracking-widest">${pendingDocs > 0 ? pendingDocs + ' Required Documents Pending' : 'All Documents Complete'}</span>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <!-- Upload Area -->
                        <div class="lg:col-span-2">
                            <form onsubmit="window.uploadDocument(event)" class="glass-card p-12 rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center text-center group cursor-pointer hover:border-secondary-fixed transition-colors mb-6">
                                <div class="w-16 h-16 bg-secondary-container border border-secondary/20 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                    <span class="material-symbols-outlined text-secondary-fixed text-3xl">upload_file</span>
                                </div>
                                <h4 class="font-headline text-xl font-bold text-white mb-2">Drag & Drop Documents</h4>
                                <p class="text-on-primary-container max-w-xs mb-4 text-sm">Securely upload bank statements, pay stubs, or tax returns in PDF or JPG format.</p>
                                <input type="file" id="doc-upload-file" class="text-white/80 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-secondary-fixed file:text-primary hover:file:brightness-110 transition-all w-full max-w-sm mb-4" required>
                                <select id="doc-category-select" class="bg-primary-container border border-white/20 rounded-lg text-white text-sm px-4 py-2 w-full max-w-xs outline-none mb-4 font-body">
                                    <option value="ID">ID / Passport</option>
                                    <option value="Income">Pay Stubs / W2</option>
                                    <option value="Assets">Bank Statements</option>
                                    <option value="Tax">Tax Returns</option>
                                    <option value="Other" selected>Other</option>
                                </select>
                                <button type="submit" id="upload-btn" class="bg-secondary-fixed text-primary px-10 py-3 rounded-lg font-headline font-extrabold text-sm tracking-wide transition-all hover:shadow-xl active:scale-95 shadow-lg shadow-secondary/10">Browse Files</button>
                            </form>
                            <!-- Document List -->
                            <div id="documents-list" class="space-y-2">
                                <p class="text-white/40 text-sm italic"><span class="material-symbols-outlined text-sm align-middle animate-spin">progress_activity</span> Loading documents...</p>
                            </div>
                        </div>
                        <!-- Compliance Guide -->
                        <div class="bg-white/5 p-10 rounded-2xl border border-white/5">
                            <h4 class="font-headline font-bold text-lg mb-6 text-secondary-fixed uppercase tracking-wider">Compliance Guide</h4>
                            <ul class="space-y-6">
                                <li class="flex gap-4 items-start">
                                    <span class="material-symbols-outlined text-secondary-fixed text-xl shrink-0">check_circle</span>
                                    <p class="text-on-primary-container text-xs leading-relaxed font-medium">Documents must be less than 3 months old for active income verification.</p>
                                </li>
                                <li class="flex gap-4 items-start">
                                    <span class="material-symbols-outlined text-secondary-fixed text-xl shrink-0">check_circle</span>
                                    <p class="text-on-primary-container text-xs leading-relaxed font-medium">Ensure all four corners of the page are visible in any photo uploads.</p>
                                </li>
                                <li class="flex gap-4 items-start">
                                    <span class="material-symbols-outlined text-secondary-fixed text-xl shrink-0">check_circle</span>
                                    <p class="text-on-primary-container text-xs leading-relaxed font-medium">Redact any non-essential personal identifiers if preferred.</p>
                                </li>
                            </ul>
                            <div class="mt-12 pt-8 border-t border-white/5 flex items-center gap-3">
                                <span class="material-symbols-outlined text-secondary-fixed text-sm">verified_user</span>
                                <span class="text-[9px] uppercase tracking-[0.2em] font-bold text-white/40">Data Security Active</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </section>
    `;
}






// --- PHASE 9: ADMIN DASHBOARD ---
function renderAdminDashboard() {
    return `
        <section class="min-h-screen bg-primary pt-32 pb-24 relative overflow-hidden">
            <!-- Animated Wave Mesh Background -->
            <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                <!-- JS-animated wave canvas -->
                <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.22;"></svg>
                <!-- Radial glow accent in top-right -->
                <div class="absolute top-0 right-0 w-[70%] h-[70%]" style="background: radial-gradient(ellipse at 80% 30%, rgba(211,189,115,0.06) 0%, transparent 60%);"></div>
            </div>
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between items-center mb-12">
                    <div>
                        <h2 class="text-3xl font-black text-white uppercase tracking-tight">Broker Dashboard</h2>
                        <p class="text-secondary-fixed/80 font-bold uppercase tracking-widest text-sm mt-1">Application Management</p>
                    </div>
                    <button onclick="window.togglePortal(false)" class="px-6 py-2 rounded-full border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-all font-bold text-sm">Sign Out</button>
                </div>

                <!-- Stats Cards -->
                <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12" id="admin-stats-container">
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                    <div class="p-6 rounded-[2rem] glass-card border-white/10 animate-pulse bg-white/5 h-32"></div>
                </div>

                <div class="glass-card rounded-[3rem] border-white/10 overflow-hidden mb-12">
                    <div class="p-8 border-b border-white/10 bg-white/5 flex items-center justify-between gap-4">
                        <div>
                            <h3 class="text-xl font-black text-white uppercase tracking-wider">Agent Reviews</h3>
                            <p class="text-white/30 text-xs font-bold uppercase tracking-widest mt-1">Automated official-registry checks only</p>
                        </div>
                        <button onclick="window.loadAdminAgents()" class="px-4 py-2 rounded-full bg-white/5 text-white/60 hover:text-white text-xs font-bold uppercase tracking-widest">Refresh</button>
                    </div>
                    <div id="admin-agent-reviews" class="p-8 space-y-4 text-white/50 text-sm">Loading agent reviews...</div>
                </div>

                <!-- Applications Table -->
                <div class="glass-card rounded-[3rem] border-white/10 overflow-hidden mb-12">
                    <div class="p-8 border-b border-white/10 bg-white/5">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider">Recent Applications</h3>
                    </div>
                    <div class="overflow-x-auto scrollbar-hide">
                        <table class="w-full text-left border-collapse min-w-[800px]">
                            <thead>
                                <tr class="bg-primary">
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Borrower</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Type</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Amount</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest">Status</th>
                                    <th class="py-4 px-8 text-xs font-black text-white/40 uppercase tracking-widest text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="admin-applications-tbody" class="text-white/80">
                                <tr><td colspan="5" class="p-8 text-center text-white/30"><span class="material-symbols-outlined animate-spin text-2xl">progress_activity</span> Loading...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Active Application Detail View -->
                <div id="admin-active-app" class="hidden grid-cols-1 lg:grid-cols-3 gap-8">
                    <!-- App Details & Notes -->
                    <div class="glass-card rounded-[3rem] border-white/10 p-8 flex flex-col">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider mb-6">Details & Notes</h3>
                        
                        <!-- Details will go here -->
                        <div id="admin-app-details" class="mb-6 space-y-3 p-4 rounded-2xl bg-white/5 border border-white/10 text-sm">
                            <p class="text-white/40 italic">Select an application...</p>
                        </div>
                        
                        <h4 class="text-xs font-bold text-secondary-fixed uppercase tracking-widest mb-3 mt-auto">Internal Broker Notes</h4>
                        <textarea id="admin-notes-input" class="w-full focus:outline-none focus:border-secondary-fixed bg-white/5 border border-white/20 rounded-2xl p-4 text-white text-sm resize-none h-32 mb-4" placeholder="Enter private notes here..."></textarea>
                        
                        <button id="admin-save-notes-btn" class="w-full py-3 rounded-full bg-secondary-fixed text-primary font-black text-sm uppercase tracking-widest hover:bg-white transition-all">Save Notes</button>
                    </div>

                    <!-- Chat -->
                    <div class="glass-card rounded-[3rem] border-white/10 p-8">
                        <div class="flex justify-between items-center mb-6">
                            <h3 id="admin-chat-title" class="text-xl font-black text-white uppercase tracking-wider">Messages</h3>
                        </div>
                        <div id="chat-messages" class="h-64 overflow-y-auto mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                        </div>
                        <form id="admin-chat-form" class="flex gap-4">
                            <input type="text" id="chat-input" placeholder="Type message..." class="flex-1 bg-white/5 border border-white/20 rounded-full text-white px-6 py-3 outline-none focus:border-secondary-fixed transition-colors" required>
                            <button type="submit" class="w-12 h-12 rounded-full bg-secondary-fixed text-primary flex items-center justify-center hover:bg-white transition-all">
                                <span class="material-symbols-outlined">send</span>
                            </button>
                        </form>
                    </div>

                    <!-- Documents & Conditions -->
                    <div class="glass-card rounded-[3rem] border-white/10 p-8 flex flex-col">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider mb-4">Needs List (Conditions)</h3>
                        <div id="admin-conditions-list" class="mb-6 border-b border-white/10 pb-6">
                             <p class="text-white/40 text-sm italic">Select an application to manage conditions.</p>
                        </div>

                        <h3 class="text-xl font-black text-white uppercase tracking-wider mb-6 mt-2">Uploaded Documents</h3>
                        <div id="admin-documents-list" class="space-y-2 mb-6 max-h-48 overflow-y-auto pr-2">
                            <p class="text-white/40 text-sm italic">Select an application to view documents.</p>
                        </div>
                        
                        <!-- Admin Upload Form -->
                        <form id="admin-upload-form" onsubmit="window.uploadAdminDocument(event)" class="mt-auto flex flex-col gap-3 bg-white/5 p-4 rounded-xl border border-white/10 hidden">
                             <input type="hidden" id="admin-upload-userid" value="">
                             <h4 class="text-xs font-bold text-[#EAB308] uppercase tracking-widest leading-none">Upload to Borrower</h4>
                             <input type="file" id="admin-doc-file" class="text-white/80 text-xs w-full file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:bg-white/10 file:text-white hover:file:bg-white/20 transition-all" required>
                             <button type="submit" id="admin-upload-btn" class="w-full py-2 rounded-full bg-white/10 text-white font-bold text-xs uppercase tracking-widest hover:bg-white hover:text-primary transition-all border border-white/20">Send Document</button>
                        </form>
                    </div>
                </div>
            </div>
        </section>
    `;
}

window.loadAdminData = async function() {
    try {
        const statsRes = await authFetch('/api/admin/stats');
        const stats = await statsRes.json();
        
        const statsContainer = document.getElementById('admin-stats-container');
        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-white/40 font-bold uppercase tracking-widest text-xs mb-2">Total Borrowers</div>
                    <div class="text-4xl font-black text-white">${stats.totalUsers}</div>
                </div>
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-secondary-fixed/80 font-bold uppercase tracking-widest text-xs mb-2">Total Apps</div>
                    <div class="text-4xl font-black text-secondary-fixed">${stats.totalApps}</div>
                </div>
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-yellow-500/80 font-bold uppercase tracking-widest text-xs mb-2">Under Review</div>
                    <div class="text-4xl font-black text-yellow-500">${stats.underReview}</div>
                </div>
                <div class="p-6 rounded-[2rem] glass-card border-white/10 bg-primary/50">
                    <div class="text-green-500/80 font-bold uppercase tracking-widest text-xs mb-2">Approved</div>
                    <div class="text-4xl font-black text-green-500">${stats.approved}</div>
                </div>
            `;
        }

        const appsRes = await authFetch('/api/admin/applications');
        const { applications } = await appsRes.json();
        window.loadAdminAgents();
        
        const tbody = document.getElementById('admin-applications-tbody');
        if (tbody) {
            if (applications.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-white/40">No applications yet.</td></tr>';
            } else {
                tbody.innerHTML = applications.map(app => `
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer" onclick="window.viewApplication('${app._id}', '${app.userName || app.userEmail}', '${app.user}')">
                        <td class="py-4 px-8">
                            <div class="font-bold text-white">${app.userName || app.userEmail}</div>
                            <div class="text-xs text-white/40">${app.userEmail}</div>
                        </td>
                        <td class="py-4 px-8 font-medium">${app.loanType}</td>
                        <td class="py-4 px-8 font-medium">$${app.loanAmount.toLocaleString()}</td>
                        <td class="py-4 px-8">
                            <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest 
                                ${app.status === 'Approved' ? 'bg-green-500/20 text-green-400' : 
                                  app.status === 'Under Review' ? 'bg-yellow-500/20 text-yellow-400' : 
                                  'bg-primary text-secondary-fixed'}">
                                ${app.status}
                            </span>
                        </td>
                        <td class="py-4 px-8 text-right" onclick="event.stopPropagation()">
                            <select onchange="window.updateAppStatus('${app._id}', this.value)" class="bg-primary border border-white/20 rounded-lg text-white text-xs px-2 py-1 outline-none">
                                <option value="" disabled selected>Update Status</option>
                                <option value="Under Review">Under Review</option>
                                <option value="Approved">Approved</option>
                                <option value="Denied">Denied</option>
                            </select>
                        </td>
                    </tr>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Failed to load admin data:', error);
    }
}

window.loadAdminAgents = async function() {
    const container = document.getElementById('admin-agent-reviews');
    if (!container) return;
    try {
        const res = await authFetch('/api/admin/agents');
        const data = await res.json();
        const agents = data.agents || [];
        if (!agents.length) {
            container.innerHTML = '<p class="text-white/40 italic">No agent applications yet.</p>';
            return;
        }
        container.innerHTML = agents.map(profile => {
            const user = profile.userId || {};
            const auto = profile.automatedVerification || {};
            return `
                <div class="p-5 rounded-2xl bg-white/5 border border-white/10">
                    <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
                        <div>
                            <div class="text-white font-black">${user.name || 'Agent'} <span class="text-white/30 font-medium">${user.email || ''}</span></div>
                            <div class="text-white/40 text-xs mt-2">${profile.licenseClass} • FSRA ${profile.licenseNumber} • ${profile.brokerageName}</div>
                            <div class="text-white/30 text-[10px] uppercase tracking-widest mt-2">Status: ${profile.verificationStatus.replace('_', ' ')}</div>
                            <div class="text-white/30 text-[10px] uppercase tracking-widest mt-1">Automated Check: ${auto.status || 'unchecked'}</div>
                            ${auto.failures?.length ? `<div class="text-red-300 text-xs mt-3 max-w-2xl">${auto.failures.join(' ')}</div>` : ''}
                            ${profile.registryProfileUrl ? `<a href="${profile.registryProfileUrl}" target="_blank" class="inline-flex mt-3 text-secondary-fixed text-xs font-bold uppercase tracking-widest hover:text-white">Open FSRA Registry</a>` : ''}
                        </div>
                        <div class="flex flex-col sm:flex-row gap-2 min-w-fit">
                            <input id="agent-registry-${profile._id}" value="${profile.registryProfileUrl || ''}" placeholder="Registry URL" class="bg-primary border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-secondary-fixed">
                            <button onclick="window.updateAgentVerification('${profile._id}', 'retry')" class="px-4 py-2 rounded-xl bg-green-500/20 text-green-300 font-black uppercase tracking-widest text-[10px]">Retry Check</button>
                            <button onclick="window.updateAgentVerification('${profile._id}', 'rejected')" class="px-4 py-2 rounded-xl bg-red-500/20 text-red-300 font-black uppercase tracking-widest text-[10px]">Reject</button>
                            <button onclick="window.updateAgentVerification('${profile._id}', 'suspended')" class="px-4 py-2 rounded-xl bg-white/10 text-white/60 font-black uppercase tracking-widest text-[10px]">Suspend</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        container.innerHTML = '<p class="text-red-300 text-xs font-bold uppercase tracking-widest">Agent reviews failed to load.</p>';
    }
}

window.updateAgentVerification = async function(profileId, status) {
    const registryInput = document.getElementById('agent-registry-' + profileId);
    const payload = { status, registryProfileUrl: registryInput ? registryInput.value : '' };
    if (status === 'rejected') {
        payload.rejectionReason = prompt('Reason for rejection?') || 'FSRA registry details could not be confirmed.';
    }
    try {
        await authFetch('/api/admin/agents/' + profileId + '/verification', {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
        window.loadAdminAgents();
    } catch (error) {
        alert('Agent verification update failed.');
    }
}

window.viewApplication = async function(appId, name, userId) {
    const detailView = document.getElementById('admin-active-app');
    if (detailView) {
        detailView.classList.remove('hidden');
        detailView.classList.add('grid');
        
        document.getElementById('admin-chat-title').innerText = `Chat: ${name}`;
        
        const form = document.getElementById('admin-chat-form');
        form.onsubmit = (e) => window.sendMessage(e, appId);
        
        window.loadMessages(appId);
        
        // Fetch specific app data to get details & notes
        try {
            const appRes = await authFetch(`/api/admin/applications`);
            const appData = await appRes.json();
            const fullApp = appData.applications.find(a => a._id === appId);
            
            if (fullApp) {
                // Populate Details
                document.getElementById('admin-app-details').innerHTML = `
                    <div class="flex justify-between items-center"><span class="text-white/50">Address:</span> <span class="text-white font-bold text-right">${fullApp.propertyAddress || 'TBD'}</span></div>
                    <div class="flex justify-between items-center"><span class="text-white/50">Loan Amount:</span> <span class="text-white font-bold">$${fullApp.loanAmount.toLocaleString()}</span></div>
                    <div class="flex justify-between items-center"><span class="text-white/50">Verified Income:</span> <span class="text-green-400 font-bold">$${(fullApp.verifiedIncome || 0).toLocaleString()}</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Property Type:</span> <span class="text-white font-bold">${fullApp.propertyDetails?.propertyType || 'N/A'}</span></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Occupancy:</span> <span class="text-white font-bold">${fullApp.propertyDetails?.occupancyType || 'N/A'}</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Employment History:</span> <span class="text-white font-bold">${fullApp.employmentHistory?.length || 0} Records</span></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Residential History:</span> <span class="text-white font-bold">${fullApp.residentialHistory?.length || 0} Records</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Credit Score:</span> <span class="text-secondary-fixed font-bold">${fullApp.creditScore || 'Pending'}</span></div>
                    <div class="flex justify-between items-center mb-1"><span class="text-white/50">Declarations:</span> <span class="${fullApp.declarations?.bankruptcy ? 'text-red-400' : 'text-green-400'} font-bold">Checked</span></div>
                    
                    <div class="mt-4 pt-4 border-t border-white/10"></div>
                    <div class="flex justify-between items-center"><span class="text-white/50">Submitted On:</span> <span class="text-white font-bold">${new Date(fullApp.createdAt).toLocaleDateString()}</span></div>

                    <!-- LOS Export Button -->
                    <div class="mt-8">
                        <a href="/api/admin/applications/${appId}/export" 
                           class="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-xs hover:bg-white transition-all shadow-xl"
                           download>
                            <span class="material-symbols-outlined text-xl">file_download</span>
                            Export to LOS (FNM 3.2)
                        </a>
                        <p class="text-[10px] text-white/30 text-center mt-3 uppercase font-bold tracking-tighter italic">Legacy MISMO Format for Encompass/Calyx</p>
                    </div>
                `;
                
                // Populate Notes
                document.getElementById('admin-notes-input').value = fullApp.adminNotes || '';
                
                // Bind Save Button event
                const saveBtn = document.getElementById('admin-save-notes-btn');
                saveBtn.onclick = () => window.saveAdminNotes(appId);
            }
                // Render Admin Conditions (Needs List)
                const conditionsList = document.getElementById('admin-conditions-list');
                if (conditionsList && fullApp) {
                    let condHtml = `
                        <div class="mb-4 flex gap-2">
                            <input type="text" id="admin-new-condition-name" placeholder="E.g., 2024 W2" class="flex-1 bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white text-sm outline-none focus:border-secondary-fixed">
                            <button onclick="window.adminAddCondition('${appId}')" class="bg-secondary-fixed text-primary px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-white transition-all">Request</button>
                        </div>
                        <div class="space-y-2 max-h-48 overflow-y-auto pr-2">
                    `;
                    
                    if (!fullApp.conditions || fullApp.conditions.length === 0) {
                        condHtml += '<p class="text-white/40 text-sm italic">No conditions requested.</p>';
                    } else {
                        fullApp.conditions.forEach(cond => {
                            condHtml += `
                                <div class="p-4 rounded-xl bg-white/5 border border-white/10">
                                    <div class="flex justify-between items-start mb-2">
                                        <div>
                                            <div class="text-white font-bold text-sm">${cond.name}</div>
                                            <div class="text-[10px] uppercase font-bold tracking-widest ${cond.status === 'Pending' ? 'text-yellow-400' : cond.status === 'Uploaded' ? 'text-blue-400' : cond.status === 'Accepted' ? 'text-green-400' : 'text-red-400'}">${cond.status}</div>
                                        </div>
                                        <select onchange="window.adminUpdateCondition('${appId}', '${cond._id}', this.value)" class="bg-primary border border-white/20 rounded-lg text-white text-xs px-2 py-1 outline-none">
                                            <option value="" disabled selected>Update</option>
                                            <option value="Pending">Pending</option>
                                            <option value="Accepted">Accepted</option>
                                            <option value="Rejected">Rejected</option>
                                        </select>
                                    </div>
                                </div>
                            `;
                        });
                    }
                    condHtml += '</div>';
                    conditionsList.innerHTML = condHtml;
                }
        } catch (e) {
            console.error(e);
        }

        // Fetch user documents
        try {
            const docsRes = await authFetch(`/api/admin/documents/${userId}`);
            const docsData = await docsRes.json();
            const docsList = document.getElementById('admin-documents-list');

            const uploadForm = document.getElementById('admin-upload-form');
            const userIdInput = document.getElementById('admin-upload-userid');
            if (uploadForm && userIdInput) {
                uploadForm.classList.remove('hidden');
                userIdInput.value = userId;
            }
            
            if (docsData.documents.length === 0) {
                docsList.innerHTML = '<p class="text-white/40 text-sm">No documents found.</p>';
            } else {
                docsList.innerHTML = docsData.documents.map(doc => `
                    <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-secondary-fixed">
                                <span class="material-symbols-outlined text-xl">description</span>
                            </div>
                            <div>
                                <div class="text-white font-bold text-sm">` + doc.originalName + `</div>
                                <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">` + doc.category + ` &bull; ` + (doc.size / 1024 / 1024).toFixed(2) + ` MB</div>
                            </div>
                        </div>
                        <a href="` + doc.url + `" target="_blank" class="text-secondary-fixed hover:text-white transition-colors">
                            <span class="material-symbols-outlined text-xl">download</span>
                        </a>
                    </div>
                `).join('');
            }
        } catch (e) {
            console.error(e);
        }
    }
}

// --- NEW OVERLAY LOGIC FOR ADMIN DASHBOARD ---
window.saveAdminNotes = async function(appId) {
    const notesInput = document.getElementById('admin-notes-input');
    const btn = document.getElementById('admin-save-notes-btn');
    const originalText = btn.innerText;

    btn.innerText = 'Saving...';
    btn.disabled = true;

    try {
        const res = await authFetch(`/api/admin/applications/${appId}/notes`, {
            method: 'PATCH',
            body: JSON.stringify({ notes: notesInput.value })
        });
        
        if (res.ok) {
            btn.innerHTML = '<span class="material-symbols-outlined">check</span> Saved';
            btn.classList.replace('bg-secondary-fixed', 'bg-green-500');
            setTimeout(() => {
                btn.innerText = originalText;
                btn.classList.replace('bg-green-500', 'bg-secondary-fixed');
                btn.disabled = false;
            }, 2000);
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Notes Error:', error);
        btn.innerText = 'Error';
        setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 2000);
    }
}

window.uploadAdminDocument = async function(event) {
    event.preventDefault();
    const fileInput = document.getElementById('admin-doc-file');
    const userId = document.getElementById('admin-upload-userid').value;
    const btn = document.getElementById('admin-upload-btn');
    
    if (!fileInput.files[0] || !userId) return;

    const originalText = btn.innerText;
    btn.innerText = 'Uploading...';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('category', 'Broker Upload');
    formData.append('targetUserId', userId);

    try {
        const token = localStorage.getItem('jwt_token');
        const res = await fetch('/api/documents/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const data = await res.json();
        if (data.success) {
            fileInput.value = '';
            btn.innerHTML = '<span class="material-symbols-outlined">check</span> Sent';
            btn.classList.add('bg-green-500', 'text-white', 'border-transparent');
            
            // Refetch docs
            const docsRes = await authFetch(`/api/admin/documents/${userId}`);
            const docsData = await docsRes.json();
            const docsList = document.getElementById('admin-documents-list');
            
            if (docsData.documents.length > 0) {
                docsList.innerHTML = docsData.documents.map(doc => `
                    <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-secondary-fixed">
                                <span class="material-symbols-outlined text-xl">description</span>
                            </div>
                            <div>
                                <div class="text-white font-bold text-sm">` + doc.originalName + `</div>
                                <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">` + doc.category + `</div>
                            </div>
                        </div>
                        <a href="` + doc.url + `" target="_blank" class="text-secondary-fixed hover:text-white transition-colors">
                            <span class="material-symbols-outlined text-xl">download</span>
                        </a>
                    </div>
                `).join('');
            }

            setTimeout(() => {
                btn.innerText = originalText;
                btn.classList.remove('bg-green-500', 'text-white', 'border-transparent');
                btn.disabled = false;
            }, 2000);
        } else {
            alert(data.error || 'Upload failed');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        console.error(error);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}


window.updateAppStatus = async function(appId, newStatus) {
    if (!newStatus) return;
    try {
        await authFetch('/api/admin/applications/' + appId, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        window.loadAdminData();
    } catch (error) {
        console.error('Failed to update status:', error);
        alert('Failed to update status');
    }
}

// --- PHASE 13: DEVELOPER CONTROLS ---
window.addSampleApp = async function() {
    try {
        const res = await authFetch('/api/applications/sample', { method: 'POST' });
        if (res.ok) {
            window.trackEvent('DevTools', 'Sample App Added');
            await window.checkUserStatus(); // Refresh state
            const appContent = document.getElementById('app-content');
            if (appContent) {
                appContent.innerHTML = renderPortal(); document.querySelector(`nav`).classList.remove(`hidden`);
                window.loadDocuments();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                initScrollReveal();
            }
        }
    } catch (err) {
        console.error('Failed to add sample app:', err);
    }
}

window.resetBorrower = async function() {
    if (!confirm('Are you sure you want to WIPE all your application data and restart from Step 1?')) return;
    try {
        const res = await authFetch('/api/applications/reset', { method: 'DELETE' });
        if (res.ok) {
            window.trackEvent('DevTools', 'Portal Reset');
            await window.checkUserStatus(); // Refresh state
            window.nextWizardStep(0); // Reset wizard state internally
            
            const appContent = document.getElementById('app-content');
            if (appContent) {
                appContent.innerHTML = renderPortal(); document.querySelector(`nav`).classList.remove(`hidden`);
                window.loadDocuments();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                initScrollReveal();
            }
        }
    } catch (err) {
        console.error('Failed to reset borrower:', err);
    }
}

window.adminAddCondition = async function(appId) {
    const nameInput = document.getElementById('admin-new-condition-name');
    if (!nameInput.value) return;

    try {
        await authFetch('/api/admin/applications/' + appId + '/conditions', {
            method: 'POST',
            body: JSON.stringify({ name: nameInput.value })
        });
        window.loadAdminData();
        alert('Condition requested successfully.');
        document.getElementById('admin-active-app').classList.add('hidden');
    } catch (e) { console.error(e); }
};

window.adminUpdateCondition = async function(appId, conditionId, status) {
    try {
        await authFetch('/api/admin/applications/' + appId + '/conditions/' + conditionId, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
        window.loadAdminData();
        alert('Condition status updated.');
        document.getElementById('admin-active-app').classList.add('hidden');
    } catch (e) { console.error(e); }
};

// --- PHASE 9: DOCUMENTS ---
window.uploadDocument = async function(event) {
    event.preventDefault();
    const fileInput = document.getElementById('doc-upload-file');
    const categorySelect = document.getElementById('doc-category-select');
    const file = fileInput.files[0];
    
    if (!file) return alert('Please select a file.');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', categorySelect.value);

    const btn = document.getElementById('upload-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span> Uploading...';
    btn.disabled = true;

    try {
        const token = localStorage.getItem('jwt_token');
        const response = await fetch('/api/documents/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        
        if (response.ok) {
            fileInput.value = '';
            window.loadDocuments();
        } else {
            const data = await response.json();
            alert('Upload failed: ' + data.error);
        }
    } catch (error) {
        console.error('Upload Error:', error);
        alert('Upload completely failed.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

window.deleteDocument = async function(docId) {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
        await authFetch('/api/documents/' + docId, { method: 'DELETE' });
        window.loadDocuments();
    } catch (error) {
        console.error('Delete failed:', error);
    }
}

window.uploadConditionDoc = async function(event, conditionId, applicationId) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', 'Condition Fulfillment');
    formData.append('conditionId', conditionId);
    formData.append('applicationId', applicationId);

    try {
        const token = localStorage.getItem('jwt_token');
        const response = await fetch('/api/documents/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        
        if (response.ok) {
            await window.checkUserStatus(); // Refresh user status to get updated conditions
            window.loadDocuments();
        } else {
            const data = await response.json();
            alert('Upload failed: ' + data.error);
        }
    } catch (error) {
        console.error('Upload Error:', error);
        alert('Upload completely failed.');
    }
}

window.loadDocuments = async function() {
    try {
        const res = await authFetch('/api/documents');
        const data = await res.json();
        
        const list = document.getElementById('documents-list');
        const conditions = window.userStatus?.application?.conditions || [];

        if (list) {
            let html = '';
            
            // Needs List Header
            if (conditions.length > 0) {
                html += '<h4 class="font-headline text-lg font-bold text-secondary-fixed mb-4 uppercase tracking-widest mt-4 border-b border-white/10 pb-2">Needs List (Action Required)</h4>';
                
                conditions.forEach(cond => {
                    const isPending = cond.status === 'Pending' || cond.status === 'Rejected';
                    html += `
                        <div class="flex items-center justify-between p-4 rounded-xl ${isPending ? 'bg-secondary-fixed/10 border-secondary-fixed/30' : 'bg-green-500/10 border-green-500/30'} border mb-2">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center ${isPending ? 'text-secondary-fixed' : 'text-green-500'}">
                                    <span class="material-symbols-outlined text-xl">${isPending ? 'error' : 'check_circle'}</span>
                                </div>
                                <div>
                                    <div class="text-white font-bold text-sm">${cond.name}</div>
                                    <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">${cond.status} ${cond.brokerNote ? ' • Note: ' + cond.brokerNote : ''}</div>
                                </div>
                            </div>
                            ${isPending ? `
                                <div class="relative overflow-hidden group">
                                    <button class="bg-secondary-fixed text-primary px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-widest">Upload</button>
                                    <input type="file" onchange="window.uploadConditionDoc(event, '${cond._id}', '${window.userStatus.application._id}')" class="absolute inset-0 opacity-0 cursor-pointer">
                                </div>
                            ` : ''}
                        </div>
                    `;
                });
            }

            html += '<h4 class="font-headline text-lg font-bold text-white mb-4 uppercase tracking-widest mt-8 border-b border-white/10 pb-2">Uploaded Documents</h4>';

            if (data.documents.length === 0) {
                html += '<p class="text-white/40 text-sm italic">No documents uploaded yet.</p>';
            } else {
                html += data.documents.map(doc => `
                    <div class="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10 mb-2">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-secondary-fixed">
                                <span class="material-symbols-outlined text-xl">description</span>
                            </div>
                            <div>
                                <div class="text-white font-bold text-sm">${doc.originalName}</div>
                                <div class="text-white/40 text-[10px] uppercase font-bold tracking-widest">${doc.category} • ${(doc.size / 1024 / 1024).toFixed(2)} MB</div>
                            </div>
                        </div>
                        <button onclick="window.deleteDocument('${doc._id}')" class="text-red-400/60 hover:text-red-400 transition-colors p-2">
                            <span class="material-symbols-outlined">delete</span>
                        </button>
                    </div>
                `).join('');
            }
            list.innerHTML = html;
        }
    } catch (error) {
        console.error('Failed to load documents:', error);
    }
}

// --- PHASE 9: MESSAGING ---
window.loadMessages = async function(appId) {
    if (!appId) return;
    
    // Join the WebSocket room for real-time updates
    if (socket) {
        socket.emit('join_application', appId);
    }

    try {
        const res = await authFetch('/api/applications/' + appId + '/messages');
        const data = await res.json();
        const chatContainer = document.getElementById('chat-messages');
        
        if (chatContainer) {
            if (!data.messages || data.messages.length === 0) {
                chatContainer.innerHTML = '<p class="text-white/40 text-sm italic text-center py-8">No messages yet. Send a message to start chatting.</p>';
                return;
            }
            
            chatContainer.innerHTML = data.messages.map(msg => `
                <div class="flex flex-col ${msg.senderRole === window.userStatus.role ? 'items-end' : 'items-start'}">
                    <div class="max-w-[80%] rounded-2xl p-4 ${msg.senderRole === window.userStatus.role ? 'bg-secondary-fixed text-primary rounded-tr-sm' : 'bg-primary text-white border border-white/10 rounded-tl-sm'}">
                        <div class="text-[10px] uppercase font-black tracking-widest opacity-50 mb-1">${msg.senderName}</div>
                        <div class="text-sm font-medium">${msg.message}</div>
                    </div>
                    <div class="text-[10px] text-white/30 mt-1">${new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
            `).join('');
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

window.sendMessage = async function(event, appId) {
    event.preventDefault();
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    input.disabled = true;
    try {
        await authFetch('/api/applications/' + appId + '/messages', {
            method: 'POST',
            body: JSON.stringify({ message })
        });
        input.value = '';
        window.loadMessages(appId);
    } catch (error) {
        console.error('Failed to send message:', error);
    } finally {
        input.disabled = false;
        input.focus();
    }
}

// --- TEST ADMIN VIEW BUTTON LOGIC ---
window.testAdminView = function() {
    const appContent = document.getElementById('app-content');
    appContent.innerHTML = renderAdminDashboard();
    window.loadAdminData();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    initScrollReveal();
}

// --- PHASE 8: PERSISTENCE LOGIC ---
window.checkUserStatus = async function() {
    try {
        const response = await authFetch('/api/user_status', { method: 'POST' });
        const data = await response.json();
        
        // Store globally for other functions to use
        window.userStatus = data;

        if (data.isSynced) {
            // 1. Identity Status Sync
            if (data.identityStatus === 'Verified') {
                const idBtn = document.getElementById('persona-start-btn');
                if (idBtn) {
                     idBtn.parentElement.innerHTML = `
                        <div class="py-12 rounded-3xl border-2 border-green-500/50 bg-green-500/10 flex flex-col items-center justify-center">
                            <span class="material-symbols-outlined text-4xl text-green-500 mb-4 scale-125 transition-transform duration-500">check_circle</span>
                            <span class="text-green-500 font-bold uppercase tracking-widest text-xs">Identity Authenticated</span>
                        </div>
                    `;
                }
            }

            // 2. Credit Score Sync
            if (data.creditScore) {
                const creditBtn = document.getElementById('credit-pull-btn');
                if (creditBtn) {
                    creditBtn.parentElement.innerHTML = `
                        <div class="flex flex-col items-center">
                            <div class="text-5xl font-black text-secondary-fixed mb-2">${data.creditScore}</div>
                            <div class="text-white/40 font-bold uppercase tracking-widest text-[10px]">Verified FICO® Score</div>
                        </div>
                    `;
                    const nextBtn = document.getElementById('credit-next-btn');
                    if (nextBtn) {
                        nextBtn.disabled = false;
                        nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                        nextBtn.innerHTML = 'Review & Continue';
                    }
                }
            }
        }
    } catch (error) {
        console.error('Persistence Check Failed:', error);
    }
}

// Run status check on load
// Consolidated into primary DOMContentLoaded listener at top of file

// --- PHASE 8: PERSONA IDENTITY VERIFICATION ---
window.startPersonaVerification = async function() {
    console.log('🚀 Initializing Persona Verification...');
    const btn = document.getElementById('persona-start-btn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-4xl mb-4">progress_activity</span><span class="text-xs uppercase tracking-widest">Generating Session...</span>';

    try {
        const response = await authFetch('/api/create_inquiry', { method: 'POST' });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Server rejected inquiry request');
        }

        const { templateId, referenceId } = await response.json();
        console.log(`📡 Persona Session Data Received: ${templateId}`);

        if (!templateId) throw new Error('Persona Template ID is missing');

        if (typeof Persona === 'undefined') {
            if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-4xl mb-4 text-red-500">gpp_maybe</span><span class="text-xs uppercase tracking-widest text-center px-4">Adblocker Detected.<br>Please disable it to Verify ID.</span>';
            console.error('❌ Persona SDK failed to load. Likely blocked by an Adblocker or Privacy Shield.');
            return;
        }

        const client = new Persona.Client({
            templateId: templateId,
            referenceId: referenceId,
            environment: "sandbox",
            onReady: () => {
                window.trackEvent('Verification', 'Persona Started');
                client.open();
            },
            onComplete: async ({ inquiryId }) => {
                window.trackEvent('Verification', 'Persona Completed');
                console.log(`✅ Persona Verified: ${inquiryId}`);
                // Notify backend
                await authFetch('/api/persona_complete', {
                    method: 'POST',
                    body: JSON.stringify({ inquiryId, status: 'Verified' })
                });

                // Update UI
                const container = document.getElementById('persona-verification-container');
                if (container) {
                    container.innerHTML = `
                        <div class="py-12 rounded-3xl border-2 border-green-500/50 bg-green-500/10 flex flex-col items-center justify-center">
                            <span class="material-symbols-outlined text-4xl text-green-500 mb-4 scale-125 transition-transform duration-500">check_circle</span>
                            <span class="text-green-500 font-bold uppercase tracking-widest text-xs">Identity Authenticated</span>
                        </div>
                    `;
                }
                const nextBtn = document.getElementById('id-next-btn');
                if (nextBtn) {
                    nextBtn.disabled = false;
                    nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                    nextBtn.innerHTML = 'Identity Verified - Proceed';
                }
            },
            onCancel: () => {
                console.log('❌ Persona Cancelled.');
                if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-4xl text-white/20 mb-4">fingerprint</span><span class="text-xs uppercase tracking-widest">Retry ID Verification</span>';
            },
            onError: (error) => {
                console.error('Persona SDK Error:', error);
                if (btn) btn.innerHTML = '<span class="material-symbols-outlined text-4xl mb-4 text-red-500">warning</span><span class="text-xs uppercase tracking-widest text-center px-4">Persona SDK Error. Check Console.</span>';
            }
        });
    } catch (error) {
        console.error('❌ Failed to start Persona:', error);
        if (btn) {
            btn.innerHTML = `<span class="material-symbols-outlined text-4xl mb-4 text-red-500">warning</span><span class="text-xs uppercase tracking-widest text-center px-4">${error.message || 'Error Loading Session'}</span>`;
        }
    }
};

window.startPayment = async function(applicationId) {
    try {
        console.log('💳 Initiating Appraisal Fee Payment...');
        const response = await authFetch('/api/payments/create-checkout-session', {
            method: 'POST',
            body: JSON.stringify({ applicationId })
        });
        
        const data = await response.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            throw new Error(data.error || 'Failed to create checkout session');
        }
    } catch (error) {
        console.error('❌ Payment Error:', error);
        alert('Payment Error: ' + error.message);
    }
};

window.simulatePersonaSuccess = async function() {
    console.log('🧪 Simulating Persona Success...');
    const inquiryId = 'inq_simulated_' + Math.random().toString(36).substr(2, 9);
    
    // Call the real backend completion route
    const response = await authFetch('/api/persona_complete', {
        method: 'POST',
        body: JSON.stringify({ inquiryId, status: 'Verified' })
    });

    if (response.ok) {
        // Update UI
        const container = document.getElementById('persona-verification-container');
        if (container) {
            container.innerHTML = `
                <div class="py-12 rounded-3xl border-2 border-green-500/50 bg-green-500/10 flex flex-col items-center justify-center">
                    <span class="material-symbols-outlined text-4xl text-green-500 mb-4 scale-125 transition-transform duration-500">check_circle</span>
                    <span class="text-green-500 font-bold uppercase tracking-widest text-xs">Identity Verified</span>
                </div>
            `;
        }
        const nextBtn = document.getElementById('id-next-btn');
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            nextBtn.innerHTML = 'Identity Verified - Proceed';
        }
    }
}

window.pullCreditRecord = async function() {
    console.log('📉 Fetching Credit Score...');
    const btn = document.getElementById('credit-pull-btn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin mr-2">progress_activity</span> Fetching Record...';
    
    // Gather Secure Form Data
    const ssn = document.getElementById('cp-ssn')?.value;
    const dob = document.getElementById('cp-dob')?.value;
    const addressLine1 = document.getElementById('cp-address')?.value;
    const city = document.getElementById('cp-city')?.value;
    const state = document.getElementById('cp-state')?.value;
    const zip = document.getElementById('cp-zip')?.value;

    try {
        const response = await authFetch('/api/credit_pull', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssn, dob, addressLine1, city, state, zip })
        });
        const data = await response.json();
        
        if (data.success) {
            window.trackEvent('Verification', 'Credit Pull Success');
            const container = document.getElementById('credit-status-container');
            if (container) {
                container.innerHTML = `
                    <div class="flex flex-col items-center">
                        <div class="text-5xl font-black text-secondary-fixed mb-2">${data.score}</div>
                        <div class="text-white/40 font-bold uppercase tracking-widest text-[10px] mb-6">Verified FICO® Score</div>
                        
                        <div class="w-full p-4 rounded-2xl bg-white/5 border border-white/10 text-left">
                            <div class="flex justify-between mb-2">
                                <span class="text-[9px] font-black text-white/20 uppercase tracking-widest">Bureau Rating</span>
                                <span class="text-green-500 font-bold uppercase text-[10px] tracking-widest">${data.rating}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-[9px] font-black text-white/20 uppercase tracking-widest">Report ID</span>
                                <span class="text-white/40 font-mono text-[9px]">${data.reportId}</span>
                            </div>
                        </div>
                    </div>
                `;
            }
            const nextBtn = document.getElementById('credit-next-btn');
            if (nextBtn) {
                nextBtn.disabled = false;
                nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                nextBtn.innerHTML = 'Complete Application';
            }
        } else {
            console.error('Credit Pull Failed:', data.error);
            if (btn) btn.innerHTML = `<span class="text-red-400">Error: ${data.error || 'Check fields'}</span>`;
            setTimeout(() => { if (btn) btn.innerHTML = 'Verify via Experian'; }, 3000);
        }
    } catch (error) {
        console.error('Credit verification network error:', error);
        if (btn) btn.innerHTML = '<span class="text-red-400">Network Error</span>';
        setTimeout(() => { if (btn) btn.innerHTML = 'Verify via Experian'; }, 3000);
    }
}

// --- 1003 DYNAMIC ROW HELPERS ---
window.addEmploymentRow = function() {
    const list = document.getElementById('employment-rows');
    if (list) {
        const row = document.createElement('div');
        row.className = 'employment-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 reveal reveal-up';
        row.innerHTML = `
            <input type="text" placeholder="Employer Name" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-name">
            <input type="text" placeholder="Position/Title" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-title">
            <input type="date" class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-start">
            <input type="number" placeholder="Gross Monthly Income" class="w-full bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold employer-income">
        `;
        list.appendChild(row);
    }
}

window.addResidencyRow = function() {
    const list = document.getElementById('residency-rows');
    if (list) {
        const row = document.createElement('div');
        row.className = 'residency-row p-6 rounded-3xl bg-white/5 border border-white/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 reveal reveal-up';
        row.innerHTML = `
            <input type="text" placeholder="Full Home Address" class="lg:col-span-2 bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-address">
            <select class="bg-transparent border-b border-white/20 px-2 py-2 text-white outline-none focus:border-secondary-fixed transition-all text-sm font-bold res-status">
                <option value="Own">Own</option>
                <option value="Rent">Rent</option>
                <option value="LivingRentFree">Living Rent Free</option>
            </select>
        `;
        list.appendChild(row);
    }
}

function renderAgentDashboard() {
    const user = window.userStatus || {};
    const profile = user.agentProfile || {};
    if (profile.verificationStatus !== 'approved') {
        const auto = profile.automatedVerification || {};
        const identity = profile.identityVerification || {};
        const layer1Done = identity.status === 'completed';
        const layer2Done = auto.status === 'passed';
        const layer3Pending = profile.verificationStatus === 'pending_admin';
        const isRejected = profile.verificationStatus === 'rejected';
        const isSuspended = profile.verificationStatus === 'suspended';
        const statusLabel = isSuspended ? 'Access Suspended' : isRejected ? 'Verification Failed' : layer3Pending ? 'Awaiting Admin Approval' : layer2Done ? 'Registry Verified' : layer1Done ? 'Identity Verified' : 'Agent Verification Required';
        const statusCopy = isSuspended ? 'Your professional access is currently suspended. Borrower invites and client messaging are disabled.' : isRejected ? (profile.rejectionReason || 'Your details could not be verified. Please contact support.') : layer3Pending ? 'Your identity and license have been verified automatically. An administrator will review and approve your account shortly.' : layer1Done ? 'Your government ID and selfie have been verified. We are now checking your FSRA registry details.' : 'To prevent impersonation, all agents must complete a 3-step verification process.';
        return `
            <div class="min-h-screen bg-primary flex items-center justify-center p-6 relative overflow-hidden">
                <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                    <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.15;"></svg>
                </div>
                <div class="max-w-2xl w-full glass-card border-white/10 rounded-[3rem] p-10 relative z-10">
                    <div class="w-20 h-20 rounded-3xl bg-secondary-fixed/10 border border-secondary-fixed/20 flex items-center justify-center mx-auto mb-8">
                        <span class="material-symbols-outlined text-secondary-fixed text-4xl">shield_person</span>
                    </div>
                    <h1 class="text-3xl md:text-4xl font-black text-white uppercase tracking-tight mb-4 text-center">${statusLabel}</h1>
                    <p class="text-white/50 leading-relaxed mb-10 text-center">${statusCopy}</p>
                    <div class="space-y-4 mb-10">
                        <div class="p-5 rounded-2xl ${layer1Done ? 'bg-green-500/10 border border-green-500/30' : 'bg-white/5 border border-white/10'} transition-all">
                            <div class="flex items-center gap-4">
                                <div class="w-12 h-12 rounded-2xl ${layer1Done ? 'bg-green-500/20 text-green-400' : 'bg-secondary-fixed/10 text-secondary-fixed'} flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-2xl">${layer1Done ? 'check_circle' : 'fingerprint'}</span>
                                </div>
                                <div class="flex-1">
                                    <div class="text-[10px] font-black uppercase tracking-widest ${layer1Done ? 'text-green-400' : 'text-white/30'}">Layer 1 — Identity Verification</div>
                                    <div class="text-white font-bold text-sm mt-1">${layer1Done ? 'Verified as: ' + (identity.verifiedName || user.name) : 'Government ID scan + live selfie liveness check'}</div>
                                </div>
                                ${!layer1Done && !isSuspended ? '<button onclick="window.startAgentPersona()" id="agent-persona-btn" class="px-5 py-3 rounded-xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-[10px] hover:bg-white transition-all flex-shrink-0">' + (identity.status === 'failed' ? 'Retry' : 'Verify Now') + '</button>' : ''}
                            </div>
                            ${identity.status === 'failed' ? '<div class="mt-3 text-red-400 text-xs">Identity verification failed. Please try again with a valid government ID.</div>' : ''}
                        </div>
                        <div class="p-5 rounded-2xl ${layer2Done ? 'bg-green-500/10 border border-green-500/30' : layer1Done ? 'bg-white/5 border border-white/10' : 'bg-white/[0.02] border border-white/5 opacity-40'} transition-all">
                            <div class="flex items-center gap-4">
                                <div class="w-12 h-12 rounded-2xl ${layer2Done ? 'bg-green-500/20 text-green-400' : layer1Done ? 'bg-secondary-fixed/10 text-secondary-fixed' : 'bg-white/5 text-white/20'} flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-2xl">${layer2Done ? 'check_circle' : 'domain_verification'}</span>
                                </div>
                                <div class="flex-1">
                                    <div class="text-[10px] font-black uppercase tracking-widest ${layer2Done ? 'text-green-400' : 'text-white/30'}">Layer 2 — FSRA License Registry</div>
                                    <div class="text-white font-bold text-sm mt-1">${layer2Done ? 'License confirmed against official FSRA database' : 'Automated cross-reference against the Ontario registry'}</div>
                                </div>
                                ${layer1Done && !layer2Done && !isSuspended ? '<button onclick="window.retryAgentVerification()" class="px-5 py-3 rounded-xl bg-white/10 text-white font-black uppercase tracking-widest text-[10px] hover:bg-white/20 transition-all flex-shrink-0">Retry Check</button>' : ''}
                            </div>
                            ${auto.failures?.length && layer1Done ? '<div class="mt-3 p-3 rounded-xl bg-red-500/10 text-red-300 text-xs leading-relaxed">' + auto.failures.join(' ') + '</div>' : ''}
                        </div>
                        <div class="p-5 rounded-2xl ${profile.verificationStatus === 'approved' ? 'bg-green-500/10 border border-green-500/30' : layer3Pending ? 'bg-secondary-fixed/10 border border-secondary-fixed/30' : 'bg-white/[0.02] border border-white/5 opacity-40'} transition-all">
                            <div class="flex items-center gap-4">
                                <div class="w-12 h-12 rounded-2xl ${profile.verificationStatus === 'approved' ? 'bg-green-500/20 text-green-400' : layer3Pending ? 'bg-secondary-fixed/10 text-secondary-fixed' : 'bg-white/5 text-white/20'} flex items-center justify-center flex-shrink-0">
                                    <span class="material-symbols-outlined text-2xl">${profile.verificationStatus === 'approved' ? 'check_circle' : layer3Pending ? 'hourglass_top' : 'admin_panel_settings'}</span>
                                </div>
                                <div class="flex-1">
                                    <div class="text-[10px] font-black uppercase tracking-widest ${layer3Pending ? 'text-secondary-fixed' : 'text-white/30'}">Layer 3 — Admin Review</div>
                                    <div class="text-white font-bold text-sm mt-1">${layer3Pending ? 'Your profile is queued for manual admin review' : 'A MajesticEquity administrator will finalize your approval'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-left bg-white/5 rounded-2xl p-6 mb-8">
                        <div><div class="text-white/30 text-[10px] font-black uppercase tracking-widest">FSRA Licence</div><div class="text-white font-bold">${profile.licenseNumber || 'Submitted'}</div></div>
                        <div><div class="text-white/30 text-[10px] font-black uppercase tracking-widest">Class</div><div class="text-white font-bold">${profile.licenseClass || 'Ontario'}</div></div>
                        <div class="md:col-span-2"><div class="text-white/30 text-[10px] font-black uppercase tracking-widest">Brokerage</div><div class="text-white font-bold">${profile.brokerageName || user.brokerageName || 'Submitted'}</div></div>
                    </div>
                    <div class="flex justify-center gap-4">
                        <button onclick="window.portalSignOut()" class="px-6 py-3 rounded-full border border-white/20 text-white/60 hover:text-white transition-all font-bold text-sm">Sign Out</button>
                    </div>
                </div>
            </div>
        `;
    }
    return `
        <div class="min-h-screen bg-primary pb-24 relative overflow-hidden">
            <!-- Animated Wave Mesh Background -->
            <div class="absolute inset-0 z-0" style="background: radial-gradient(ellipse 120% 80% at 70% 50%, rgba(30,50,80,1) 0%, rgba(15,30,46,1) 40%, rgba(10,20,35,1) 100%);">
                <svg id="portal-wave-svg" viewBox="0 0 1200 800" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" style="opacity: 0.15;"></svg>
            </div>

            <div class="max-w-7xl mx-auto px-6 relative z-10 pt-32">
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16 reveal reveal-up">
                    <div>
                        <div class="flex items-center gap-3 mb-4">
                            <span class="px-3 py-1 bg-secondary-fixed/10 border border-secondary-fixed/20 text-secondary-fixed text-[10px] font-black uppercase tracking-widest rounded-full">Professional Portal</span>
                        </div>
                        <h1 class="text-4xl md:text-6xl font-black text-white uppercase tracking-tight">Expert <span class="text-secondary-fixed">Dashboard</span></h1>
                        <p class="text-white/40 font-bold uppercase tracking-[0.2em] mt-2">Welcome back, ${user.name || 'Agent'}</p>
                    </div>
                    
                    <div class="flex items-center gap-4">
                        <div class="text-right hidden md:block">
                            <div class="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Affiliated Brokerage</div>
                            <div class="text-white font-bold">${user.brokerageName || 'Independent'}</div>
                        </div>
                        <div class="w-16 h-16 rounded-2xl glass-card border-white/10 flex items-center justify-center text-secondary-fixed">
                             <span class="material-symbols-outlined text-3xl">verified</span>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <!-- Agent Stats -->
                    <div class="glass-card p-10 rounded-[3rem] border-white/10 reveal reveal-up">
                        <div class="flex items-center gap-4 mb-8 text-secondary-fixed">
                            <span class="material-symbols-outlined">group</span>
                            <span class="text-[10px] font-black uppercase tracking-widest">Active Pipeline</span>
                        </div>
                        <div class="text-5xl font-black text-white mb-2 italic" id="agent-pipeline-count">0</div>
                        <p class="text-white/40 text-xs font-bold uppercase tracking-widest mb-8">Loan Applications</p>
                        <button onclick="document.getElementById('agent-client-list')?.scrollIntoView({behavior:'smooth'})" class="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white/60 hover:text-white font-black uppercase tracking-widest text-[10px]">View Pipeline</button>
                    </div>

                    <!-- Professional Credentials -->
                    <div class="glass-card p-10 rounded-[3rem] border-white/10 reveal reveal-up" style="transition-delay: 100ms">
                        <div class="flex items-center gap-4 mb-8 text-secondary-fixed">
                            <span class="material-symbols-outlined">badge</span>
                            <span class="text-[10px] font-black uppercase tracking-widest">Verified Credentials</span>
                        </div>
                        <div class="space-y-4">
                             <div class="flex justify-between items-center">
                                <span class="text-white/30 text-[10px] font-black uppercase tracking-widest">FSRA Licence</span>
                                <span class="text-white font-bold">${profile.licenseNumber || user.nmlsId || 'Pending'}</span>
                             </div>
                             <div class="flex justify-between items-center">
                                <span class="text-white/30 text-[10px] font-black uppercase tracking-widest">License</span>
                                <span class="text-white font-bold">${profile.licenseClass || 'Ontario'}</span>
                             </div>
                             <div class="flex justify-between items-center">
                                <span class="text-white/30 text-[10px] font-black uppercase tracking-widest">Status</span>
                                <span class="text-green-400 font-bold uppercase tracking-widest text-[10px]">Active Member</span>
                             </div>
                        </div>
                        <button onclick="window.showSecurity()" class="w-full py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-[10px] mt-8 hover:bg-white transition-all">Account Security</button>
                    </div>

                    <!-- Invite Center -->
                    <div class="glass-card p-10 rounded-[3rem] border-white/10 reveal reveal-up" style="transition-delay: 200ms">
                        <div class="flex items-center gap-4 mb-8 text-secondary-fixed">
                            <span class="material-symbols-outlined">person_add</span>
                            <span class="text-[10px] font-black uppercase tracking-widest">Invite Borrower</span>
                        </div>
                        <form onsubmit="window.createAgentInvite(event)" class="space-y-4">
                            <input id="agent-invite-name" type="text" placeholder="Borrower name" class="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-white placeholder:text-white/20 outline-none focus:border-secondary-fixed">
                            <input id="agent-invite-email" type="email" placeholder="borrower@email.com" class="w-full bg-white/5 border border-white/10 rounded-2xl py-3 px-4 text-white placeholder:text-white/20 outline-none focus:border-secondary-fixed">
                            <button id="agent-invite-btn" class="w-full py-4 rounded-2xl bg-secondary-fixed text-primary font-black uppercase tracking-widest text-[10px] hover:bg-white transition-all">Create Invite</button>
                        </form>
                    </div>
                </div>

                <div class="mt-16 grid grid-cols-1 lg:grid-cols-2 gap-8 reveal reveal-up">
                    <div class="glass-card rounded-[3rem] border-white/10 p-8">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider mb-6">Invite Status</h3>
                        <div id="agent-invite-list" class="space-y-3 text-white/50 text-sm">Loading invites...</div>
                    </div>
                    <div class="glass-card rounded-[3rem] border-white/10 p-8">
                        <h3 class="text-xl font-black text-white uppercase tracking-wider mb-6">Assigned Clients</h3>
                        <div id="agent-client-list" class="space-y-3 text-white/50 text-sm">Loading clients...</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.retryAgentVerification = async function() {
    try {
        const res = await authFetch('/api/agent/verification/retry', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Verification retry failed.');
        await window.checkUserStatus();
        window.showPortalDashboard();
    } catch (error) {
        alert(error.message || 'Verification retry failed.');
    }
}

window.startAgentPersona = async function() {
    console.log('🚀 Initializing Agent Persona Verification (Layer 1)...');
    const btn = document.getElementById('agent-persona-btn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm mr-1">progress_activity</span>Loading...';

    try {
        const response = await authFetch('/api/agent/verify-identity', { method: 'POST' });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Server rejected identity request');
        }

        const { templateId, referenceId } = await response.json();
        if (!templateId) throw new Error('Persona Template ID is missing');

        if (typeof Persona === 'undefined') {
            if (btn) btn.innerHTML = 'Adblocker Detected';
            console.error('Persona SDK blocked by adblocker.');
            return;
        }

        const client = new Persona.Client({
            templateId: templateId,
            referenceId: referenceId,
            environment: "sandbox",
            onReady: () => {
                window.trackEvent('Verification', 'Agent Persona Started');
                client.open();
            },
            onComplete: async ({ inquiryId }) => {
                window.trackEvent('Verification', 'Agent Persona Completed');
                console.log('✅ Agent Persona Verified:', inquiryId);

                // Notify backend (server-to-server validation + auto-chain to FSRA)
                const completeRes = await authFetch('/api/agent/persona-complete', {
                    method: 'POST',
                    body: JSON.stringify({ inquiryId })
                });
                const completeData = await completeRes.json();

                if (completeData.success) {
                    await window.checkUserStatus();
                    window.showPortalDashboard();
                } else {
                    alert('Identity verification could not be confirmed. Please try again.');
                    await window.checkUserStatus();
                    window.showPortalDashboard();
                }
            },
            onCancel: () => {
                console.log('❌ Agent Persona Cancelled.');
                if (btn) btn.innerHTML = 'Verify Now';
            },
            onError: (error) => {
                console.error('Persona SDK Error:', error);
                if (btn) btn.innerHTML = 'Error — Retry';
            }
        });
    } catch (error) {
        console.error('❌ Failed to start Agent Persona:', error);
        if (btn) btn.innerHTML = error.message || 'Error';
        setTimeout(() => { if (btn) btn.innerHTML = 'Verify Now'; }, 3000);
    }
}

window.loadAgentData = async function() {
    if (!window.userStatus || window.userStatus.role !== 'agent' || window.userStatus.agentProfile?.verificationStatus !== 'approved') return;
    try {
        const [appsRes, invitesRes] = await Promise.all([
            authFetch('/api/agent/applications'),
            authFetch('/api/agent/invites')
        ]);
        const appsData = await appsRes.json();
        const invitesData = await invitesRes.json();
        const applications = appsData.applications || [];
        const invites = invitesData.invites || [];

        const count = document.getElementById('agent-pipeline-count');
        if (count) count.textContent = applications.length;

        const inviteList = document.getElementById('agent-invite-list');
        if (inviteList) {
            inviteList.innerHTML = invites.length ? invites.map(invite => `
                <div class="p-4 rounded-2xl bg-white/5 border border-white/10">
                    <div class="flex justify-between gap-4">
                        <div>
                            <div class="text-white font-bold">${invite.borrowerName || invite.borrowerEmail || 'Open invite'}</div>
                            <div class="text-white/40 text-[10px] uppercase tracking-widest mt-1">${invite.borrowerEmail || 'No email'} • Expires ${new Date(invite.expiresAt).toLocaleDateString()}</div>
                        </div>
                        <span class="text-[10px] font-black uppercase tracking-widest ${invite.status === 'used' ? 'text-green-400' : 'text-secondary-fixed'}">${invite.status}</span>
                    </div>
                </div>
            `).join('') : '<p class="text-white/40 italic">No invites created yet.</p>';
        }

        const clientList = document.getElementById('agent-client-list');
        if (clientList) {
            clientList.innerHTML = applications.length ? applications.map(app => `
                <button onclick="window.openAgentClient('${app._id}', '${(app.userName || app.userEmail).replace(/'/g, "\\'")}')" class="w-full text-left p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                    <div class="flex justify-between gap-4">
                        <div>
                            <div class="text-white font-bold">${app.userName || app.userEmail}</div>
                            <div class="text-white/40 text-[10px] uppercase tracking-widest mt-1">${app.loanType} • $${(app.loanAmount || 0).toLocaleString()}</div>
                        </div>
                        <span class="text-[10px] font-black uppercase tracking-widest text-secondary-fixed">${app.status}</span>
                    </div>
                </button>
            `).join('') : '<p class="text-white/40 italic">No assigned borrowers yet. Create an invite to begin.</p>';
        }
    } catch (error) {
        console.error('Failed to load agent data:', error);
    }
}

window.createAgentInvite = async function(event) {
    event.preventDefault();
    const nameInput = document.getElementById('agent-invite-name');
    const emailInput = document.getElementById('agent-invite-email');
    const btn = document.getElementById('agent-invite-btn');
    const original = btn.innerHTML;
    btn.innerHTML = 'Creating...';
    btn.disabled = true;
    try {
        const res = await authFetch('/api/agent/invites', {
            method: 'POST',
            body: JSON.stringify({
                borrowerName: nameInput.value,
                borrowerEmail: emailInput.value
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invite failed');
        nameInput.value = '';
        emailInput.value = '';
        await navigator.clipboard?.writeText(data.invite.inviteUrl).catch(() => {});
        alert('Invite created. Link copied when browser permissions allow:\n' + data.invite.inviteUrl);
        window.loadAgentData();
    } catch (error) {
        alert(error.message || 'Invite failed');
    } finally {
        btn.innerHTML = original;
        btn.disabled = false;
    }
}

window.openAgentClient = async function(appId, name) {
    const clientList = document.getElementById('agent-client-list');
    if (!clientList) return;
    clientList.innerHTML = `
        <div class="p-4 rounded-2xl bg-white/5 border border-white/10">
            <div class="flex items-center justify-between mb-4">
                <h4 class="text-white font-black uppercase tracking-widest">${name}</h4>
                <button onclick="window.loadAgentData()" class="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest">Back</button>
            </div>
            <div id="chat-messages" class="h-64 overflow-y-auto mb-4 p-4 rounded-2xl bg-primary/60 border border-white/10 space-y-4"></div>
            <form onsubmit="window.sendMessage(event, '${appId}')" class="flex gap-3">
                <input id="chat-input" class="flex-1 bg-white/5 border border-white/20 rounded-full text-white px-5 py-3 outline-none focus:border-secondary-fixed" placeholder="Message borrower..." required>
                <button class="w-12 h-12 rounded-full bg-secondary-fixed text-primary flex items-center justify-center"><span class="material-symbols-outlined">send</span></button>
            </form>
        </div>
    `;
    window.loadMessages(appId);
}

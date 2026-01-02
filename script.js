// CONFIG: CLOUDFLARE WORKER URL
        // এখানে আপনার ওয়ার্কারের লিংক বসান (যেমন: https://wallet-api.yourname.workers.dev)
        const API_URL = "https://bttcminerpro.nlnahid2020.workers.dev"; 

        const tg = window.Telegram.WebApp;
        tg.ready(); tg.expand();

        // LOCAL STATE
        let appState = { 
            user: { balance: 0, totalEarned: 0, referrals: 0, dailyAds: {}, taskHistory: {} },
            config: {}, 
            leaderboard: [], 
            history: [] 
        };

        // API HELPER FUNCTION
        async function api(action, method = 'GET', body = null) {
            try {
                let url = `${API_URL}?action=${action}`;
                if (method === 'GET' && body) {
                    // For GET params
                    Object.keys(body).forEach(k => url += `&${k}=${body[k]}`);
                }
                const opts = { method: method };
                if (method !== 'GET' && body) opts.body = JSON.stringify(body);
                
                const res = await fetch(url, opts);
                return await res.json();
            } catch (e) {
                console.error("API Error", e);
                return null;
            }
        }

        window.onload = async () => {
            // 1. TELEGRAM ID CHECK
            if (!tg.initDataUnsafe || !tg.initDataUnsafe.user) {
                // Testing only
                // tg.initDataUnsafe = { user: { id: "test_123", first_name: "Tester", photo_url: "" }, start_param: "" };
                // return; 
            }
            const tgUser = tg.initDataUnsafe.user;

            // 2. SET UI IMMEDIATELY
            document.getElementById('u-name').innerText = tgUser.first_name;
            document.getElementById('u-id').innerText = `ID: ${tgUser.id}`;
            if(tgUser.photo_url) document.getElementById('u-img').src = tgUser.photo_url;

            // 3. LOAD LOCAL STORAGE (Cache)
            const cached = localStorage.getItem(`app_${tgUser.id}`);
            if(cached) {
                appState = JSON.parse(cached);
                renderAll(); 
            } else {
                appState.user.id = tgUser.id;
            }

            try {
                // 4. FETCH CONFIG & LOGIN
                const [config, user] = await Promise.all([
                    api('getConfig'),
                    api('login', 'POST', {
                        id: tgUser.id,
                        firstName: tgUser.first_name,
                        photoUrl: tgUser.photo_url || '',
                        refId: tg.initDataUnsafe.start_param
                    })
                ]);

                if(config) appState.config = config;
                
                if(user) {
                    // Merge DB user with local state logic
                    appState.user = { ...appState.user, ...user };
                    // Ensure local tracking objects exist
                    if(!appState.user.dailyAds) appState.user.dailyAds = {};
                    if(!appState.user.taskHistory) appState.user.taskHistory = {};
                }

                // 5. FETCH LEADERBOARD
                const lb = await api('getLeaderboard');
                if(lb) appState.leaderboard = lb;

                // 6. FETCH HISTORY
                const hist = await api('getHistory', 'GET', { id: tgUser.id });
                if(hist) appState.history = hist;

                // 7. FINALIZE
                saveLocal();
                renderAll();
                document.getElementById('loader').style.display = 'none';
                document.getElementById('app').style.display = 'block';

            } catch (e) {
                console.error(e);
                document.getElementById('loader').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                toast("Offline / API Error");
            }
        };

        // --- HELPERS ---
        function saveLocal() {
            localStorage.setItem(`app_${appState.user.id}`, JSON.stringify(appState));
        }

        // --- RENDER ---
        function renderAll() {
            const sym = appState.config.currencySymbol || "TK";
            document.querySelectorAll('.currency').forEach(e => e.innerText = sym);
            
            const u = appState.user;
            document.getElementById('u-bal').innerText = u.balance||0;
            document.getElementById('u-earn').innerText = u.totalEarned||0;
            document.getElementById('u-ref').innerText = u.referrals || 0;
            document.getElementById('ref-link').value = `https://t.me/${appState.config.botUsername}?startapp=${u.id}`;

            renderAds(); renderTasks(); renderEarningsHistory(); renderLeaderboard(); renderHistory(); renderMethods(); loadAdScripts();
        }

        // --- ADS (Client Side Logic + Server Sync) ---
        function loadAdScripts() {
            (appState.config.adSlots||[]).forEach(s => {
                if(s.network==='monetag' && !document.querySelector(`script[data-zone="${s.id}"]`)) {
                    let sc=document.createElement('script'); sc.src='//libtl.com/sdk.js'; sc.dataset.zone=s.id; sc.dataset.sdk=`show_${s.id}`; document.body.appendChild(sc);
                } else if(s.network==='gigapub') {
                    let sc=document.createElement('script'); sc.src=`https://ad.gigapub.tech/script?id=${s.id}`; document.body.appendChild(sc);
                }
            });
        }
        function renderAds() {
            const el = document.getElementById('ad-area'); el.innerHTML = '';
            const today = new Date().toISOString().slice(0,10);
            if(appState.user.lastActive !== today) { appState.user.dailyAds = {}; appState.user.lastActive = today; saveLocal(); }
            (appState.config.adSlots||[]).forEach((s, i) => {
                const limit = appState.config.dailyAdLimit || 10;
                const done = (appState.user.dailyAds && appState.user.dailyAds[s.id]) || 0;
                const max = done >= limit;
                el.innerHTML += `<div class="ad-card ${max?'disabled':''}" onclick="${max?'':`watchAd('${s.id}','${s.network}')`}"><i class="fas fa-play"></i><h4>Ad Slot ${i+1}</h4><span>${done}/${limit} Watched</span></div>`;
            });
        }
        function watchAd(id, net) {
            toast("Loading..."); tg.HapticFeedback.impactOccurred('light');
            let p;
            if(net==='monetag' && window[`show_${id}`]) p = window[`show_${id}`]();
            else if(net==='gigapub' && window.showGiga) p = window.showGiga();
            else { toast("Not Ready"); return; }

            p.then(async () => {
                const r = appState.config.adReward || 0.5;
                // Local Update
appState.user.balance += r;
appState.user.totalEarned += r;

if(!appState.user.dailyAds) appState.user.dailyAds = {};
appState.user.dailyAds[id] = (appState.user.dailyAds[id] || 0) + 1;

// ✅ Updated Earnings record function with referral support and server sync
async function addEarning(type, amount, refAmount=0) {
    if(!appState.user.history) appState.user.history = [];

    // Main earning
    appState.user.history.push({ type: type, amount: amount, ts: Date.now() });

    // Add referral earning if any
    if(refAmount > 0){
        appState.user.history.push({ type: 'referral', amount: refAmount, ts: Date.now() });
        appState.user.balance += refAmount;      // Ref bonus added to balance
        appState.user.totalEarned += refAmount;  // Ref bonus counted in total earned
    }

    appState.user.balance += amount;
    appState.user.totalEarned += amount;

    saveLocal();             // Save locally
    renderEarningsHistory(); // Update UI
    renderAll();             // Optional: if you have a full render

    // Server Sync
    await api('updateBalance', 'POST', { id: appState.user.id, amount: amount, refAmount: refAmount });
}

// Add daily ad earning
addEarning('dailyAd', r);

// Add referral earning (যদি থাকে)
if(typeof refAmount !== 'undefined' && refAmount > 0) {
    addEarning('referral', refAmount);
}

// Other UI & feedback
renderAll();
toast(`Success! +${r}`);
tg.HapticFeedback.notificationOccurred('success');

// Server Sync
await api('updateBalance', 'POST', { id: appState.user.id, amount: r });

              if(!appState.user.history) appState.user.history = [];
appState.user.history.push({ type: 'referral', amount: refAmount, ts: Date.now() });
saveLocal(); // localStorage update
renderEarningsHistory(); // UI update
              
            }).catch(() => toast("Failed/Closed"));
        }

        // --- TASKS ---
        function renderTasks() {
            const el = document.getElementById('task-area'); el.innerHTML = '';
            const today = new Date().toISOString().slice(0,10);
            const tasks = appState.config.webTasks || {};
            const sym = appState.config.currencySymbol || "TK";
            const now = Date.now();
            let pending=[], completed=[];

            Object.keys(tasks).forEach(k => {
                const t = tasks[k];
                const h = (appState.user.taskHistory && appState.user.taskHistory[k]) || {};
                
                // 1. Hide OneTime if Done
                if(t.type === 'onetime' && h.ts) return; 

                // 2. Daily Logic
                let isDone = false;
                let btnHtml = '';
                
                if(t.type === 'daily') {
                    if (h.ts && (now - h.ts) < 86400000) { 
                        isDone = true;
                        const left = 86400000 - (now - h.ts);
                        const hrs = Math.floor((left / (1000 * 60 * 60)) % 24);
                        const mins = Math.floor((left / (1000 * 60)) % 60);
                        btnHtml = `<button class="btn-act btn-wait" disabled>Wait ${hrs}h ${mins}m</button>`;
                    }
                }

                if(!isDone) btnHtml = `<button id="btn-${k}" class="btn-act btn-start" onclick="runTask('${k}')">Start</button>`;

                const html = `<div class="task-item" style="opacity:${isDone?0.6:1}"><div class="task-left"><img src="${t.icon||'https://via.placeholder.com/40'}" class="task-icon"><div class="task-info"><h4>${t.name}</h4><small>+${t.reward} ${sym}</small></div></div>${btnHtml}</div>`;
                if(isDone) completed.push(html); else pending.push(html);
            });
            el.innerHTML = pending.join('') + completed.join('');
        }
        function runTask(id) {
            const t = appState.config.webTasks[id];
            tg.openLink(t.url); tg.HapticFeedback.impactOccurred('medium');
            const btn = document.getElementById(`btn-${id}`);
            let s = 15; btn.className = 'btn-act btn-wait'; btn.disabled = true;
            const i = setInterval(() => {
                btn.innerText = `${s}s`; s--;
                if(s < 0) { clearInterval(i); btn.className = 'btn-act btn-claim'; btn.innerText = 'Claim'; btn.disabled = false; btn.onclick = () => claimTask(id, t); }
            }, 1000);
        }
        async function claimTask(id, t) {
            // Local Update
            appState.user.balance += t.reward;
            appState.user.totalEarned += t.reward;
            if(!appState.user.taskHistory) appState.user.taskHistory = {};
            appState.user.taskHistory[id] = { ts: Date.now() };
          
          // ✅ Earnings record add
if(!appState.user.history) appState.user.history = [];
appState.user.history.push({ type: 'task', amount: t.reward, ts: Date.now() });
          
            saveLocal(); renderAll(); toast("Claimed!"); tg.HapticFeedback.notificationOccurred('success');

            // Server Sync
            await api('updateBalance', 'POST', { id: appState.user.id, amount: t.reward });
        }

        // --- WITHDRAW ---
        async function withdraw() {
            const min = appState.config.minWithdrawReferrals || 0;
            if(appState.user.referrals < min) { document.getElementById('w-msg').style.display='block'; document.getElementById('w-msg').innerText=`Need ${min} Referrals!`; return; }
            const amt = parseFloat(document.getElementById('w-amt').value);
            const sym = appState.config.currencySymbol || "TK";
            if(!amt || amt < 100000) { toast("Min 100000 "+sym); return; }
            if(amt > appState.user.balance) { toast("Insufficient Balance"); return; }

            toast("Connecting...");
            
            // Server Call
            const res = await api('withdraw', 'POST', {
                userId: appState.user.id, 
                userName: appState.user.firstName, 
                amount: amt, 
                method: document.getElementById('w-method').value,
                account: document.getElementById('w-acc').value
            });

            if(res && res.success) {
                // Local Deduct
                appState.user.balance -= amt;
                saveLocal(); 
                
                // Refresh History
                const hist = await api('getHistory', 'GET', { id: appState.user.id });
                if(hist) appState.history = hist;
                
                renderAll();
                toast("Submitted!"); tg.HapticFeedback.notificationOccurred('success');
            } else {
                toast(res.message || "Network Error");
            }
        }

        // --- HELPERS & RENDERERS ---
        function renderLeaderboard() {
            const p = document.getElementById('podium-area'); const l = document.getElementById('lb-area');
            p.innerHTML = ''; l.innerHTML = '';
            const top = appState.leaderboard;
            if(top.length === 0) { p.innerHTML='<p style="text-align:center">No Data</p>'; return; }
            if(top[1]) p.innerHTML += getPodium(top[1], 2);
            if(top[0]) p.innerHTML += getPodium(top[0], 1);
            if(top[2]) p.innerHTML += getPodium(top[2], 3);
            for(let i=3; i<top.length; i++) {
                l.innerHTML += `<div class="lb-item"><span class="lb-rank">#${i+1}</span><img src="${top[i].photoUrl||'https://via.placeholder.com/40'}" class="lb-img"><div class="lb-name">${top[i].firstName}</div><div class="lb-val">${top[i].referrals}</div></div>`;
            }
        }
        function getPodium(u, r) { return `<div class="podium-item rank-${r}"><div class="crown"><i class="fas fa-crown"></i></div><img src="${u.photoUrl||'https://via.placeholder.com/60'}" class="podium-img"><div class="podium-name">${u.firstName}</div><div class="podium-score">${u.referrals} Refs</div></div>`; }
        function renderHistory() {
            const el = document.getElementById('hist-area'); el.innerHTML = '';
            const sym = appState.config.currencySymbol || "TK";
            if(appState.history.length === 0) { el.innerHTML='<p style="text-align:center;color:#aaa">No History</p>'; return; }
            appState.history.forEach(x => {
                el.innerHTML += `<div class="hist-item ${x.status}"><div class="hist-info"><h4>${x.method} - ${x.amount} ${sym}</h4><small>${new Date(x.timestamp).toLocaleDateString()}</small></div><span class="status-badge">${x.status}</span></div>`;
            });
        }
        function renderMethods() {
            const s = document.getElementById('w-method'); if(s.children.length > 0) return;
            (appState.config.withdrawMethods||[]).forEach(m => s.innerHTML+=`<option value="${m.name}">${m.name} (Min ${m.min})</option>`);
        }
        function nav(p, e) {
            document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
            document.getElementById(p).classList.add('active');
            document.querySelectorAll('.nav i').forEach(x => x.classList.remove('active'));
            e.classList.add('active');
            if(p==='p-profile') { 
                api('getHistory', 'GET', { id: appState.user.id }).then(hist => {
                    if(hist) { appState.history = hist; saveLocal(); renderAll(); }
                });
            }
            tg.HapticFeedback.impactOccurred('light');
        }
        function copyRef() { const e = document.getElementById('ref-link'); e.select(); document.execCommand('copy'); toast("Copied!"); }
        function shareTg() { const link = document.getElementById('ref-link').value; tg.openTelegramLink(`https://t.me/share/url?url=${link}&text=Join and Earn!`); }
        function openSupport() { if(appState.config.supportLink) tg.openLink(appState.config.supportLink); else toast("No Support Link"); }
        function toast(m) { const t = document.getElementById('toast'); t.innerText=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }

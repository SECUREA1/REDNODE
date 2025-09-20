(function(){
  const STORAGE_KEY = 'rednode_wallet_gate';
  const overlay = document.getElementById('wallet-gate');
  if(!overlay){
    return;
  }

  const connectBtn = overlay.querySelector('[data-action="connect"]');
  const verifyBtn = overlay.querySelector('[data-action="verify"]');
  const resetBtn = overlay.querySelector('[data-action="reset"]');
  const statusEl = overlay.querySelector('.wallet-status');
  const messageEl = overlay.querySelector('.wallet-message');
  const tokenInput = overlay.querySelector('#wallet-token-address');
  const amountInput = overlay.querySelector('#wallet-token-amount');
  const accountEl = overlay.querySelector('#wallet-connected-account');

  const presetAddress = overlay.dataset.tokenAddress || '';
  const presetAmount = overlay.dataset.tokenMin || '';

  let provider = null;
  let currentAccount = null;
  let verified = false;
  let pendingCallback = null;
  let currentToken = null;

  const saved = loadState();
  if(saved && saved.account){
    verified = true;
    currentAccount = saved.account;
    currentToken = saved.token || null;
    if(tokenInput){
      tokenInput.value = saved.token || presetAddress;
    }
    if(amountInput && presetAmount){
      amountInput.value = presetAmount;
    }
    updateStatus(`Access previously granted for <strong>${shorten(saved.account)}</strong>.`);
    if(accountEl){
      accountEl.textContent = shorten(saved.account);
    }
    hideOverlay();
  } else {
    if(tokenInput && presetAddress){
      tokenInput.value = presetAddress;
    }
    if(amountInput && presetAmount){
      amountInput.value = presetAmount;
    }
    showOverlay();
  }

  function showOverlay(){
    overlay.classList.remove('wallet-gate-hidden');
    document.body.classList.add('wallet-locked');
  }

  function hideOverlay(){
    overlay.classList.add('wallet-gate-hidden');
    document.body.classList.remove('wallet-locked');
  }

  function shorten(address){
    if(!address){
      return '';
    }
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }

  function updateStatus(html){
    if(statusEl){
      statusEl.innerHTML = html || '';
    }
  }

  function updateMessage(text, isError){
    if(!messageEl){
      return;
    }
    messageEl.textContent = text || '';
    messageEl.classList.toggle('error', !!isError);
  }

  async function ensureProvider(){
    if(provider){
      return provider;
    }
    if(!window.ethereum){
      throw new Error('No Ethereum provider detected. Please install MetaMask or a compatible wallet.');
    }
    provider = new ethers.BrowserProvider(window.ethereum);
    return provider;
  }

  async function connectWallet(){
    try{
      updateMessage('Requesting wallet access…');
      const browserProvider = await ensureProvider();
      const accounts = await browserProvider.send('eth_requestAccounts', []);
      if(!accounts || !accounts.length){
        throw new Error('No accounts returned from wallet.');
      }
      currentAccount = ethers.getAddress(accounts[0]);
      updateStatus(`Connected wallet <strong>${shorten(currentAccount)}</strong>.`);
      if(accountEl){
        accountEl.textContent = shorten(currentAccount);
      }
      updateMessage('');
      if(verifyBtn){
        verifyBtn.disabled = false;
      }
      return currentAccount;
    } catch(err){
      updateMessage(err.message || 'Failed to connect wallet.', true);
      throw err;
    }
  }

  async function verifyToken(){
    if(!currentAccount){
      updateMessage('Please connect your wallet first.', true);
      return;
    }
    const tokenAddress = tokenInput ? tokenInput.value.trim() : '';
    if(!tokenAddress){
      updateMessage('Enter the ERC-20 token contract address to verify.', true);
      return;
    }
    if(!ethers.isAddress(tokenAddress)){
      updateMessage('That token contract address is not valid.', true);
      return;
    }
    try{
      if(verifyBtn){
        verifyBtn.disabled = true;
      }
      updateMessage('Verifying token balance…');
      const provider = await ensureProvider();
      const contract = new ethers.Contract(tokenAddress, [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)'
      ], provider);
      const [balance, decimals, symbol] = await Promise.all([
        contract.balanceOf(currentAccount),
        contract.decimals().catch(() => 18),
        contract.symbol().catch(() => 'token')
      ]);
      const parsedRequirement = parseRequired(amountInput ? amountInput.value.trim() : '', decimals);
      if(parsedRequirement.error){
        if(verifyBtn){
          verifyBtn.disabled = false;
        }
        return;
      }
      const requiredRaw = parsedRequirement.amount;
      const hasBalance = requiredRaw === null ? balance > 0n : balance >= requiredRaw;
      if(!hasBalance){
        const requiredMsg = requiredRaw === null ? 'any amount' : `${ethers.formatUnits(requiredRaw, decimals)} ${symbol}`;
        updateMessage(`Balance check failed. You need ${requiredMsg} of this token.`, true);
        if(verifyBtn){
          verifyBtn.disabled = false;
        }
        return;
      }
      const formattedBalance = ethers.formatUnits(balance, decimals);
      updateMessage(`Verified! Detected ${Number(formattedBalance).toFixed(4)} ${symbol}.`);
      verified = true;
      currentToken = tokenAddress;
      persistState({ account: currentAccount, token: currentToken });
      hideOverlay();
      document.dispatchEvent(new CustomEvent('wallet-verified', {
        detail: { account: currentAccount, token: tokenAddress, balance: formattedBalance, symbol }
      }));
      if(typeof pendingCallback === 'function'){
        pendingCallback();
        pendingCallback = null;
      }
    } catch(err){
      updateMessage(err.message || 'Unable to verify token balance.', true);
      if(verifyBtn){
        verifyBtn.disabled = false;
      }
    }
  }

  function parseRequired(value, decimals){
    if(!value){
      return { amount: null, error: false };
    }
    try{
      const trimmed = value.replace(/,/g, '');
      if(!trimmed){
        return { amount: null, error: false };
      }
      return { amount: ethers.parseUnits(trimmed, decimals), error: false };
    } catch(err){
      updateMessage('The required amount could not be parsed. Use a numeric value.', true);
      return { amount: null, error: true };
    }
  }

  function persistState(data){
    if(!data){
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, timestamp: Date.now() }));
  }

  function loadState(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){
      return null;
    }
    try{
      return JSON.parse(raw);
    } catch(err){
      return null;
    }
  }

  function resetAccess(){
    persistState(null);
    verified = false;
    currentAccount = null;
    currentToken = null;
    pendingCallback = null;
    updateStatus('Wallet access required.');
    updateMessage('');
    if(verifyBtn){
      verifyBtn.disabled = true;
    }
    if(accountEl){
      accountEl.textContent = '—';
    }
    if(tokenInput){
      tokenInput.value = presetAddress || '';
    }
    if(amountInput){
      amountInput.value = presetAmount || '';
    }
    showOverlay();
  }

  if(connectBtn){
    connectBtn.addEventListener('click', () => {
      connectWallet().catch(() => {});
    });
  }

  if(verifyBtn){
    verifyBtn.addEventListener('click', () => {
      verifyToken();
    });
  }

  if(resetBtn){
    resetBtn.addEventListener('click', (event) => {
      event.preventDefault();
      resetAccess();
    });
  }

  if(verifyBtn){
    verifyBtn.disabled = !currentAccount;
  }

  const walletGate = {
    isVerified(){
      return verified;
    },
    requireAccess(callback){
      if(verified){
        if(typeof callback === 'function'){
          callback();
        }
        return true;
      }
      pendingCallback = typeof callback === 'function' ? callback : null;
      showOverlay();
      return false;
    },
    reset: resetAccess,
    get account(){
      return currentAccount;
    }
  };

  window.walletGate = walletGate;

  if(window.ethereum){
    window.ethereum.on('accountsChanged', (accounts) => {
      if(!accounts || !accounts.length){
        resetAccess();
        return;
      }
      currentAccount = ethers.getAddress(accounts[0]);
      if(verified){
        persistState({ account: currentAccount, token: currentToken });
      }
      updateStatus(`Connected wallet <strong>${shorten(currentAccount)}</strong>.`);
      if(accountEl){
        accountEl.textContent = shorten(currentAccount);
      }
    });
  }
})();

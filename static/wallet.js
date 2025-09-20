(function(){
  'use strict';

  const WALLET_KEY = 'rednode_wallet_address';
  const STATUS_KEY = 'rednode_wallet_status';
  const THIRDWEB_SOLANA_RPC = 'https://rpc.thirdweb.com/solana';
  const DEFAULT_SALE_URL = 'https://thirdweb.com/explore';
  const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

  let currentProvider = null;
  let currentAddress = null;
  let currentStatus = null;
  let isChecking = false;

  function readMeta(name){
    const meta = document.querySelector(`meta[name="${name}"]`);
    return meta && meta.content ? meta.content.trim() : '';
  }

  function normalizeRpcUrl(value){
    if(!value) return THIRDWEB_SOLANA_RPC;
    const trimmed = String(value).trim();
    if(!trimmed) return THIRDWEB_SOLANA_RPC;
    if(/mainnet-beta\.solana\.com/i.test(trimmed)){
      return THIRDWEB_SOLANA_RPC;
    }
    return trimmed;
  }

  function normalizeUrl(value, fallback){
    if(!value) return fallback;
    const trimmed = String(value).trim();
    if(!trimmed) return fallback;
    try {
      const url = new URL(trimmed, window.location.href);
      return url.href;
    } catch {
      return trimmed;
    }
  }

  function persist(key, value){
    try {
      if(value === null || value === undefined){
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (err) {
      console.warn('[RedNode] Failed to persist value', key, err);
    }
  }

  function load(key){
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function broadcast(name, detail){
    try {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (err) {
      console.warn('[RedNode] Event dispatch failed', name, err);
    }
  }

  function detectProvider(){
    if(currentProvider && currentProvider.isPhantom) return currentProvider;
    const phantom = window.phantom && window.phantom.solana;
    if(phantom && phantom.isPhantom) return phantom;
    const solana = window.solana;
    if(solana && solana.isPhantom) return solana;
    if(solana && Array.isArray(solana.providers)){
      const candidate = solana.providers.find((prov) => prov && prov.isPhantom);
      if(candidate) return candidate;
    }
    return null;
  }

  function formatTokenAmount(rawValue, decimals){
    try {
      const raw = typeof rawValue === 'bigint' ? rawValue : BigInt(rawValue);
      if(!decimals) return raw.toString();
      const rawStr = raw.toString().padStart(decimals + 1, '0');
      const intPart = rawStr.slice(0, -decimals) || '0';
      const fracPart = rawStr.slice(-decimals).replace(/0+$/, '');
      return fracPart ? `${intPart}.${fracPart}` : intPart;
    } catch {
      return String(rawValue ?? '0');
    }
  }

  function updateStatusUi(statusEl, message, type){
    if(!statusEl) return;
    statusEl.textContent = message;
    if(type === 'error'){
      statusEl.style.color = '#ffb3b3';
    } else if(type === 'success'){
      statusEl.style.color = '#b9ffa3';
    } else if(type === 'muted'){
      statusEl.style.color = '#ffe59a';
    } else {
      statusEl.style.color = '#fffae0';
    }
  }

  async function checkNativeSolBalance(address, rpcUrl){
    const payload = {
      jsonrpc: '2.0',
      id: `rn-sol-${Date.now()}`,
      method: 'getBalance',
      params: [address]
    };
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!response.ok){
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if(!data || !data.result){
      throw new Error('Malformed response');
    }
    const lamports = BigInt(data.result.value ?? 0);
    return { total: lamports, decimals: 9 };
  }

  async function checkTokenBalance(address, mint, rpcUrl){
    if(!mint || mint === NATIVE_SOL_MINT){
      return checkNativeSolBalance(address, rpcUrl);
    }
    const payload = {
      jsonrpc: '2.0',
      id: `rn-token-${Date.now()}`,
      method: 'getTokenAccountsByOwner',
      params: [
        address,
        { mint },
        { encoding: 'jsonParsed' }
      ]
    };
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!response.ok){
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const accounts = data && data.result && Array.isArray(data.result.value) ? data.result.value : [];
    if(accounts.length === 0){
      return { total: 0n, decimals: 0 };
    }
    let total = 0n;
    let decimals = 0;
    for(const entry of accounts){
      const info = entry && entry.account && entry.account.data && entry.account.data.parsed && entry.account.data.parsed.info;
      const tokenAmount = info && info.tokenAmount;
      if(!tokenAmount || tokenAmount.amount === undefined) continue;
      try {
        const raw = BigInt(tokenAmount.amount);
        total += raw;
        if(typeof tokenAmount.decimals === 'number'){
          decimals = tokenAmount.decimals;
        }
      } catch {}
    }
    return { total, decimals };
  }

  async function verifyWallet(address, config, statusEl){
    if(!address || isChecking) return;
    isChecking = true;
    updateStatusUi(statusEl, 'Checking wallet on thirdweb…', 'muted');
    const summary = {
      provider: 'phantom',
      address,
      mint: config.mint,
      rpcUrl: config.rpcUrl,
      checkedAt: new Date().toISOString()
    };
    try {
      const { total, decimals } = await checkTokenBalance(address, config.mint, config.rpcUrl);
      summary.totalRaw = total.toString();
      summary.decimals = decimals;
      summary.balance = formatTokenAmount(total, decimals);
      summary.verified = total > 0n;
      summary.reason = summary.verified ? 'balance_found' : 'no_balance';
      if(summary.verified){
        updateStatusUi(statusEl, `Wallet verified • Balance ${summary.balance}`, 'success');
      } else {
        updateStatusUi(statusEl, 'Wallet connected • No balance detected', 'muted');
      }
    } catch (error) {
      summary.verified = false;
      summary.reason = 'request_failed';
      summary.error = String(error && error.message ? error.message : error);
      updateStatusUi(statusEl, 'Unable to verify wallet via thirdweb RPC', 'error');
    } finally {
      isChecking = false;
      currentStatus = summary;
      persist(STATUS_KEY, summary);
      broadcast('rednode-token-status', summary);
    }
  }

  function setCurrentAddress(address){
    currentAddress = address || null;
    const context = window.APP_CONTEXT = window.APP_CONTEXT || {};
    if(currentAddress){
      context.walletAddress = currentAddress;
      persist(WALLET_KEY, currentAddress);
    } else {
      delete context.walletAddress;
      persist(WALLET_KEY, null);
    }
    broadcast('rednode-wallet-update', currentAddress);
  }

  function openSale(saleUrl){
    const target = saleUrl || DEFAULT_SALE_URL;
    try {
      window.open(target, '_blank');
    } catch {
      window.location.href = target;
    }
  }

  function setupWalletControls(config){
    const context = window.APP_CONTEXT = window.APP_CONTEXT || {};
    context.walletConfig = { ...config };

    const navButtons = document.querySelector('.nav-buttons');
    if(!navButtons){
      console.warn('[RedNode] nav buttons container not found; wallet UI skipped');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.gap = '0.5rem';
    wrapper.style.minWidth = '220px';

    const statusText = document.createElement('div');
    statusText.textContent = 'Wallet not connected';
    statusText.style.fontSize = '0.9rem';
    statusText.style.letterSpacing = '0.03em';
    statusText.style.textAlign = 'center';
    statusText.style.maxWidth = '240px';

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '0.6rem';
    buttonRow.style.flexWrap = 'wrap';
    buttonRow.style.justifyContent = 'center';

    const connectButton = document.createElement('button');
    connectButton.type = 'button';
    connectButton.className = 'nav-button wallet-connect-button';
    connectButton.textContent = 'Connect Wallet';

    const buyButton = document.createElement('button');
    buyButton.type = 'button';
    buyButton.className = 'nav-button wallet-buy-button';
    buyButton.textContent = 'Buy Access';

    connectButton.addEventListener('click', async () => {
      if(currentAddress){
        verifyWallet(currentAddress, config, statusText);
        return;
      }
      const provider = detectProvider();
      currentProvider = provider;
      if(!provider){
        updateStatusUi(statusText, 'Phantom wallet not detected. Install Phantom to continue.', 'error');
        return;
      }
      try {
        const resp = await provider.connect({ onlyIfTrusted: false });
        const publicKey = resp && resp.publicKey ? resp.publicKey : provider.publicKey;
        if(publicKey){
          const address = typeof publicKey === 'string' ? publicKey : publicKey.toString();
          setCurrentAddress(address);
          updateStatusUi(statusText, `Connected: ${address.slice(0, 4)}…${address.slice(-4)}`, 'success');
          verifyWallet(address, config, statusText);
        }
      } catch (error) {
        updateStatusUi(statusText, 'Wallet connection cancelled', 'error');
        console.warn('[RedNode] Wallet connect cancelled', error);
      }
    });

    buyButton.addEventListener('click', () => {
      openSale(config.saleUrl);
    });

    wrapper.appendChild(statusText);
    buttonRow.appendChild(connectButton);
    buttonRow.appendChild(buyButton);
    wrapper.appendChild(buttonRow);
    navButtons.appendChild(wrapper);

    const storedAddress = load(WALLET_KEY);
    if(storedAddress){
      setCurrentAddress(storedAddress);
      updateStatusUi(statusText, `Connected: ${storedAddress.slice(0, 4)}…${storedAddress.slice(-4)}`, 'success');
      verifyWallet(storedAddress, config, statusText);
    }

    const storedStatus = load(STATUS_KEY);
    if(storedStatus){
      currentStatus = storedStatus;
      broadcast('rednode-token-status', storedStatus);
      if(storedStatus.address === storedAddress){
        if(storedStatus.verified){
          updateStatusUi(statusText, `Wallet verified • Balance ${storedStatus.balance || storedStatus.totalRaw}`, 'success');
        } else if(storedStatus.reason === 'no_balance'){
          updateStatusUi(statusText, 'Wallet connected • No balance detected', 'muted');
        }
      }
    }

    const provider = detectProvider();
    if(provider){
      currentProvider = provider;
      provider.on && provider.on('accountChanged', (pubKey) => {
        if(!pubKey){
          setCurrentAddress(null);
          updateStatusUi(statusText, 'Wallet disconnected', 'muted');
          return;
        }
        const next = typeof pubKey === 'string' ? pubKey : pubKey.toString();
        setCurrentAddress(next);
        updateStatusUi(statusText, `Connected: ${next.slice(0, 4)}…${next.slice(-4)}`, 'success');
        verifyWallet(next, config, statusText);
      });
      if(provider.isConnected && provider.publicKey && !currentAddress){
        const addr = typeof provider.publicKey === 'string' ? provider.publicKey : provider.publicKey.toString();
        setCurrentAddress(addr);
        updateStatusUi(statusText, `Connected: ${addr.slice(0, 4)}…${addr.slice(-4)}`, 'success');
        verifyWallet(addr, config, statusText);
      } else {
        provider.connect && provider.connect({ onlyIfTrusted: true }).catch(() => {});
      }
    }

    const walletApi = window.RedNodeWallet = window.RedNodeWallet || {};
    walletApi.getAddress = () => currentAddress;
    walletApi.getStatus = () => currentStatus ? { ...currentStatus } : null;
    walletApi.connect = () => connectButton.click();
    walletApi.buy = () => openSale(config.saleUrl);
    walletApi.getConfig = () => ({ ...config });
  }

  function init(){
    const config = {
      mint: readMeta('rednode-token-mint') || null,
      rpcUrl: normalizeRpcUrl(readMeta('rednode-rpc-url')),
      saleUrl: normalizeUrl(readMeta('rednode-sale-url'), DEFAULT_SALE_URL)
    };
    setupWalletControls(config);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

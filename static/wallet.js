(function(){
  'use strict';

  const WALLET_STORAGE_KEY = 'rednode_wallet';
  const TOKEN_STATUS_KEY = 'rednode_token_status';
  const WALLET_CONFIG_KEY = 'rednode_wallet_config';
  const SALE_URL_KEY = 'rednode_sale_url';
  const PROVIDER_NAME = 'phantom';
  const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
  const DEFAULT_SALE_URL = null;

  let manualConnectHandler = null;
  let connectHandler = null;
  let currentContext = null;
  let currentProvider = null;
  let currentConfig = null;
  let lastVerificationId = 0;
  let gateElements = null;
  let currentContractStatus = null;

  const DEFAULT_CONFIG = Object.freeze({ mint: null, rpcUrl: DEFAULT_RPC, saleUrl: DEFAULT_SALE_URL });

  function ensureContext(){
    const ctx = window.APP_CONTEXT || {};
    if(!window.APP_CONTEXT){
      window.APP_CONTEXT = ctx;
    }
    currentContext = ctx;
    return ctx;
  }

  function persist(key, value){
    if(value === null || value === undefined){
      localStorage.removeItem(key);
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
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

  function broadcast(eventName, detail){
    try {
      document.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch {}
  }

  function readMeta(name){
    const meta = document.querySelector(`meta[name="${name}"]`);
    return meta && meta.content ? meta.content.trim() : null;
  }

  function normalizeMint(value){
    if(value === undefined) return undefined;
    if(value === null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
  }

  function normalizeRpcUrl(value){
    if(value === undefined) return undefined;
    if(value === null) return DEFAULT_RPC;
    const trimmed = String(value).trim();
    return trimmed || DEFAULT_RPC;
  }

  function normalizeSaleUrl(value){
    if(value === undefined) return undefined;
    if(value === null) return null;
    const trimmed = String(value).trim();
    if(!trimmed) return null;
    try {
      const url = new URL(trimmed, window.location.href);
      return url.href;
    } catch {
      return trimmed;
    }
  }

  function sanitizeConfig(partial){
    const result = {};
    if(partial && Object.prototype.hasOwnProperty.call(partial, 'mint')){
      result.mint = normalizeMint(partial.mint);
    }
    if(partial && Object.prototype.hasOwnProperty.call(partial, 'rpcUrl')){
      result.rpcUrl = normalizeRpcUrl(partial.rpcUrl);
    }
    if(partial && Object.prototype.hasOwnProperty.call(partial, 'saleUrl')){
      result.saleUrl = normalizeSaleUrl(partial.saleUrl);
    }
    return result;
  }

  function mergeConfig(base, partial){
    if(!partial) return base;
    const sanitized = sanitizeConfig(partial);
    if(Object.prototype.hasOwnProperty.call(sanitized, 'mint')){
      base.mint = sanitized.mint;
    }
    if(Object.prototype.hasOwnProperty.call(sanitized, 'rpcUrl')){
      base.rpcUrl = sanitized.rpcUrl;
    }
    if(Object.prototype.hasOwnProperty.call(sanitized, 'saleUrl')){
      base.saleUrl = sanitized.saleUrl;
    }
    return base;
  }

  function commitConfig(config){
    const context = ensureContext();
    const nextConfig = {
      mint: normalizeMint(config && config.mint),
      rpcUrl: normalizeRpcUrl(config && config.rpcUrl),
      saleUrl: normalizeSaleUrl(config && config.saleUrl)
    };
    currentConfig = nextConfig;
    context.walletConfig = { ...nextConfig };
    context.requiredTokenMint = nextConfig.mint;
    context.solanaRpcUrl = nextConfig.rpcUrl;
    context.tokenSaleUrl = nextConfig.saleUrl;
    persist(WALLET_CONFIG_KEY, nextConfig);
    persist(SALE_URL_KEY, nextConfig.saleUrl);
    const globalCfg = window.REDNODE_CONFIG = window.REDNODE_CONFIG || {};
    if(Object.prototype.hasOwnProperty.call(nextConfig, 'mint')){
      globalCfg.requiredTokenMint = nextConfig.mint;
    }
    if(Object.prototype.hasOwnProperty.call(nextConfig, 'rpcUrl')){
      globalCfg.rpcUrl = nextConfig.rpcUrl;
    }
    if(Object.prototype.hasOwnProperty.call(nextConfig, 'saleUrl')){
      globalCfg.saleUrl = nextConfig.saleUrl;
    }
    broadcast('rednode-wallet-config', { ...nextConfig });
    return nextConfig;
  }

  function resolveInitialConfig(){
    ensureContext();
    const fromMeta = {
      mint: readMeta('rednode-token-mint'),
      rpcUrl: readMeta('rednode-rpc-url'),
      saleUrl: readMeta('rednode-sale-url')
    };
    const stored = load(WALLET_CONFIG_KEY);
    const storedSale = load(SALE_URL_KEY);
    const globalCfg = window.REDNODE_CONFIG || {};
    const base = { ...DEFAULT_CONFIG };
    mergeConfig(base, fromMeta);
    mergeConfig(base, stored);
    mergeConfig(base, storedSale ? { saleUrl: storedSale } : null);
    mergeConfig(base, {
      mint: globalCfg.requiredTokenMint,
      rpcUrl: globalCfg.rpcUrl,
      saleUrl: globalCfg.saleUrl
    });
    return commitConfig(base);
  }

  function getActiveConfig(){
    if(currentConfig) return currentConfig;
    return resolveInitialConfig();
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

  async function verifyTokenBalance(address, config){
    const now = new Date().toISOString();
    const status = {
      provider: PROVIDER_NAME,
      address,
      mint: config.mint,
      rpcUrl: config.rpcUrl,
      verified: false,
      totalRaw: '0',
      balance: '0',
      saleUrl: config.saleUrl,
      checkedAt: now
    };

    if(!config.mint){
      status.reason = 'missing_mint';
      return status;
    }

    try {
      const response = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `rednode-${Date.now()}`,
          method: 'getTokenAccountsByOwner',
          params: [
            address,
            { mint: config.mint },
            { encoding: 'jsonParsed' }
          ]
        })
      });

      if(!response.ok){
        status.reason = `http_${response.status}`;
        return status;
      }

      const payload = await response.json();
      const accounts = payload && payload.result ? payload.result.value : null;
      status.accounts = Array.isArray(accounts) ? accounts.length : 0;

      if(!Array.isArray(accounts) || accounts.length === 0){
        status.reason = 'no_accounts';
        return status;
      }

      let total = 0n;
      let decimals = null;
      for(const entry of accounts){
        const info = entry && entry.account && entry.account.data && entry.account.data.parsed && entry.account.data.parsed.info;
        const tokenAmount = info && info.tokenAmount;
        if(!tokenAmount) continue;
        const raw = tokenAmount.amount;
        if(raw === undefined || raw === null) continue;
        try {
          const rawBig = BigInt(raw);
          total += rawBig;
          if(rawBig > 0n) status.verified = true;
          if(typeof tokenAmount.decimals === 'number'){
            decimals = tokenAmount.decimals;
          }
        } catch {}
      }

      status.totalRaw = total.toString();
      if(decimals !== null){
        status.decimals = decimals;
        status.balance = formatTokenAmount(total, decimals);
      } else {
        status.balance = total.toString();
      }

      if(status.verified){
        status.reason = 'balance_found';
      } else if(total > 0n){
        status.reason = 'zero_balance';
      } else {
        status.reason = 'no_balance';
      }
    } catch (error) {
      status.reason = 'request_failed';
      status.error = String(error && error.message ? error.message : error);
    }

    return status;
  }

  function setWallet(context, wallet){
    if(wallet){
      context.wallet = wallet;
      persist(WALLET_STORAGE_KEY, wallet);
    } else {
      delete context.wallet;
      persist(WALLET_STORAGE_KEY, null);
    }
    broadcast('rednode-wallet-update', wallet);
  }

  function setCurrentWallet(wallet){
    const context = ensureContext();
    setWallet(context, wallet);
    if(wallet && wallet.address){
      context.walletAddress = wallet.address;
    } else {
      delete context.walletAddress;
    }
  }

  async function checkMintContract(config){
    const now = new Date().toISOString();
    const status = {
      mint: config.mint,
      rpcUrl: config.rpcUrl,
      saleUrl: config.saleUrl,
      exists: false,
      checkedAt: now
    };

    if(!config.mint){
      status.reason = 'missing_mint';
      return status;
    }

    try {
      const response = await fetch(config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `rednode-contract-${Date.now()}`,
          method: 'getAccountInfo',
          params: [config.mint, { encoding: 'jsonParsed' }]
        })
      });

      if(!response.ok){
        status.reason = `http_${response.status}`;
        return status;
      }

      const payload = await response.json();
      const value = payload && payload.result ? payload.result.value : null;
      if(value){
        status.exists = true;
        status.reason = 'contract_found';
      } else {
        status.reason = 'contract_missing';
      }
    } catch (error) {
      status.reason = 'contract_check_failed';
      status.error = String(error && error.message ? error.message : error);
    }

    return status;
  }

  function applyContractStatus(status){
    currentContractStatus = status || null;
    const context = ensureContext();
    if(status){
      context.contractStatus = { ...status };
    } else {
      delete context.contractStatus;
    }
    if(status && status.reason === 'contract_missing'){
      const existing = context.tokenVerification || {};
      setTokenStatus(context, {
        provider: existing.provider || PROVIDER_NAME,
        address: existing.address,
        mint: status.mint,
        rpcUrl: status.rpcUrl,
        verified: false,
        reason: 'contract_missing',
        saleUrl: status.saleUrl,
        contractStatus: { ...status },
        checkedAt: status.checkedAt
      });
    } else if(status && status.exists && context.tokenVerification && context.tokenVerification.reason === 'contract_missing'){
      const existing = context.tokenVerification;
      setTokenStatus(context, {
        provider: existing.provider || PROVIDER_NAME,
        address: existing.address,
        mint: status.mint,
        rpcUrl: status.rpcUrl,
        verified: false,
        reason: 'disconnected',
        saleUrl: status.saleUrl,
        checkedAt: status.checkedAt
      });
    } else {
      updateGate(context.tokenVerification || null);
    }
  }

  function ensureGate(){
    if(gateElements) return gateElements;

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '99999';
    overlay.style.background = 'rgba(17, 0, 0, 0.92)';
    overlay.style.backdropFilter = 'blur(4px)';

    const panel = document.createElement('div');
    panel.style.maxWidth = '420px';
    panel.style.width = '90%';
    panel.style.background = '#210000';
    panel.style.border = '2px solid gold';
    panel.style.borderRadius = '18px';
    panel.style.padding = '32px 28px';
    panel.style.boxShadow = '0 20px 40px rgba(0,0,0,0.55)';
    panel.style.color = 'gold';
    panel.style.textAlign = 'center';
    panel.style.fontFamily = '"Segoe UI", Arial, sans-serif';

    const heading = document.createElement('h2');
    heading.textContent = 'RedNode Access Requires Token Verification';
    heading.style.marginBottom = '16px';
    heading.style.fontSize = '1.25rem';
    heading.style.letterSpacing = '0.04em';

    const statusText = document.createElement('p');
    statusText.style.marginBottom = '24px';
    statusText.style.fontSize = '0.95rem';
    statusText.style.lineHeight = '1.5';

    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.textContent = 'Connect Phantom Wallet';
    actionButton.style.padding = '12px 22px';
    actionButton.style.background = '#b30000';
    actionButton.style.color = 'gold';
    actionButton.style.border = '2px solid gold';
    actionButton.style.borderRadius = '999px';
    actionButton.style.fontSize = '0.95rem';
    actionButton.style.fontWeight = '600';
    actionButton.style.letterSpacing = '0.05em';
    actionButton.style.cursor = 'pointer';
    actionButton.style.transition = 'all 0.25s ease';
    actionButton.addEventListener('mouseenter', () => {
      actionButton.style.background = '#d00000';
      actionButton.style.transform = 'translateY(-1px)';
    });
    actionButton.addEventListener('mouseleave', () => {
      actionButton.style.background = '#b30000';
      actionButton.style.transform = 'translateY(0)';
    });
    actionButton.addEventListener('click', () => {
      triggerConnect();
    });

    const salesButton = document.createElement('button');
    salesButton.type = 'button';
    salesButton.textContent = 'Visit Token Sale';
    salesButton.style.padding = '12px 22px';
    salesButton.style.background = '#ffae00';
    salesButton.style.color = '#210000';
    salesButton.style.border = '2px solid gold';
    salesButton.style.borderRadius = '999px';
    salesButton.style.fontSize = '0.95rem';
    salesButton.style.fontWeight = '600';
    salesButton.style.letterSpacing = '0.05em';
    salesButton.style.cursor = 'pointer';
    salesButton.style.transition = 'all 0.25s ease';
    salesButton.style.display = 'none';
    salesButton.addEventListener('mouseenter', () => {
      salesButton.style.transform = 'translateY(-1px)';
      salesButton.style.boxShadow = '0 8px 16px rgba(255, 215, 0, 0.35)';
    });
    salesButton.addEventListener('mouseleave', () => {
      salesButton.style.transform = 'translateY(0)';
      salesButton.style.boxShadow = 'none';
    });

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.flexDirection = 'column';
    buttonRow.style.gap = '14px';
    buttonRow.appendChild(actionButton);
    buttonRow.appendChild(salesButton);

    panel.appendChild(heading);
    panel.appendChild(statusText);
    panel.appendChild(buttonRow);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    gateElements = { overlay, statusText, actionButton, salesButton };
    return gateElements;
  }

  function describeStatus(status){
    if(!status) return 'Connect your Phantom wallet to verify the required token and unlock the site.';
    if(status.pending) return 'Verifying the required token balance…';
    if(status.verified) return 'Token verified. Loading RedNode experience…';

    switch(status.reason){
      case 'missing_mint':
        return 'The RedNode configuration is missing the required token mint. Please contact support.';
      case 'contract_missing':
        return 'The RedNode token contract is not yet live. Visit the token sale to secure access when available.';
      case 'contract_check_failed':
        return 'We could not confirm the RedNode token contract. Please retry shortly or visit the token sale.';
      case 'provider_unavailable':
        return 'Phantom wallet is required to access RedNode. Install or enable the Phantom browser extension.';
      case 'disconnected':
        return 'Wallet disconnected. Reconnect your Phantom wallet to continue.';
      case 'no_accounts':
      case 'no_balance':
        return 'The required RedNode access token was not detected in your wallet.';
      case 'zero_balance':
        return 'Your wallet holds the access token but has a zero balance. Acquire tokens to proceed.';
      case 'http_429':
        return 'Too many requests were made to the Solana RPC. Please try again shortly.';
      case 'http_500':
      case 'http_502':
      case 'http_503':
      case 'http_504':
        return 'The Solana RPC is currently unavailable. Please try again in a moment.';
      case 'request_failed':
      case 'verification_error':
        return 'We could not verify your token balance. Please retry the connection.';
      default:
        return 'Unable to verify the required token. Please reconnect your Phantom wallet.';
    }
  }

  function mergeContractStatus(status){
    if(currentContractStatus && currentContractStatus.reason === 'contract_missing'){
      const merged = { ...(status || {}) };
      merged.reason = 'contract_missing';
      merged.contractStatus = { ...currentContractStatus };
      if(currentContractStatus.saleUrl && !merged.saleUrl){
        merged.saleUrl = currentContractStatus.saleUrl;
      }
      merged.checkedAt = merged.checkedAt || currentContractStatus.checkedAt;
      return merged;
    }
    return status;
  }

  function updateGate(status){
    if(typeof document === 'undefined' || !document.body) return;
    status = mergeContractStatus(status);
    const { overlay, statusText, actionButton, salesButton } = ensureGate();
    const provider = currentProvider || window.solana;

    if(status && status.verified){
      overlay.style.display = 'none';
      return;
    }

    overlay.style.display = 'flex';
    statusText.textContent = describeStatus(status);

    const providerAvailable = !!(provider && provider.isPhantom);
    const canRetry = providerAvailable && (!status || status.pending !== true);

    if(status && status.reason === 'contract_missing'){
      actionButton.disabled = true;
      actionButton.style.opacity = '0.7';
      actionButton.style.cursor = 'default';
      actionButton.style.display = 'none';
    } else if(providerAvailable && status && status.pending){
      actionButton.disabled = true;
      actionButton.style.opacity = '0.7';
      actionButton.style.cursor = 'default';
      actionButton.style.display = 'inline-flex';
    } else if(providerAvailable && canRetry){
      actionButton.disabled = false;
      actionButton.style.opacity = '1';
      actionButton.style.cursor = 'pointer';
      actionButton.style.display = 'inline-flex';
    } else {
      actionButton.disabled = true;
      actionButton.style.opacity = '0.7';
      actionButton.style.cursor = 'default';
      actionButton.style.display = providerAvailable ? 'inline-flex' : 'none';
    }

    const saleUrl = (status && status.saleUrl) || (currentContractStatus && currentContractStatus.saleUrl) || (getActiveConfig().saleUrl);
    if(saleUrl){
      salesButton.onclick = () => {
        try {
          if(saleUrl.startsWith('#')){
            overlay.style.display = 'none';
            window.location.hash = saleUrl;
          } else {
            window.location.href = saleUrl;
          }
        } catch {
          window.location.href = saleUrl;
        }
      };
    }
    const showSale = !!(saleUrl && status && status.reason === 'contract_missing');
    salesButton.style.display = showSale ? 'inline-flex' : 'none';
  }

  function setTokenStatus(context, status){
    currentContext = context;
    if(status){
      const config = getActiveConfig();
      const enriched = { ...status };
      if(config){
        if(!Object.prototype.hasOwnProperty.call(enriched, 'mint')) enriched.mint = config.mint;
        if(!Object.prototype.hasOwnProperty.call(enriched, 'rpcUrl')) enriched.rpcUrl = config.rpcUrl;
        if(!Object.prototype.hasOwnProperty.call(enriched, 'saleUrl') && config.saleUrl){
          enriched.saleUrl = config.saleUrl;
        }
      }
      if(currentContractStatus && currentContractStatus.reason === 'contract_missing'){
        enriched.reason = 'contract_missing';
        enriched.contractStatus = { ...currentContractStatus };
        if(currentContractStatus.saleUrl && !enriched.saleUrl){
          enriched.saleUrl = currentContractStatus.saleUrl;
        }
        enriched.checkedAt = enriched.checkedAt || currentContractStatus.checkedAt;
      }
      context.tokenVerification = enriched;
      persist(TOKEN_STATUS_KEY, enriched);
      updateGate(enriched);
    } else {
      delete context.tokenVerification;
      persist(TOKEN_STATUS_KEY, null);
      updateGate(null);
    }
    broadcast('rednode-token-status', context.tokenVerification || null);
  }

  function triggerConnect(){
    const provider = currentProvider || window.solana;
    if(!provider || !provider.isPhantom){
      return;
    }
    if(!connectHandler){
      connectHandler = handleConnectFactory(provider);
    }
    provider.connect({ onlyIfTrusted: false })
      .then((resp) => {
        if(resp && resp.publicKey){
          return connectHandler(resp);
        }
        if(provider.publicKey){
          return connectHandler({ publicKey: provider.publicKey });
        }
        return null;
      })
      .catch((err) => {
        console.warn('[RedNode] Manual Phantom connection failed', err);
        ensureManualConnect(provider, connectHandler);
      });
  }

  async function runVerification(address){
    if(!address) return null;
    const context = ensureContext();
    const config = getActiveConfig();
    const requestId = ++lastVerificationId;
    if(currentContractStatus && currentContractStatus.reason === 'contract_missing'){
      const status = {
        provider: PROVIDER_NAME,
        address,
        mint: config.mint,
        rpcUrl: config.rpcUrl,
        verified: false,
        reason: 'contract_missing',
        saleUrl: config.saleUrl,
        contractStatus: { ...currentContractStatus },
        checkedAt: new Date().toISOString()
      };
      setTokenStatus(context, status);
      return status;
    }
    const pendingStatus = {
      provider: PROVIDER_NAME,
      address,
      mint: config.mint,
      rpcUrl: config.rpcUrl,
      verified: false,
      pending: true,
      saleUrl: config.saleUrl,
      checkedAt: new Date().toISOString()
    };
    setTokenStatus(context, pendingStatus);
    try {
      const result = await verifyTokenBalance(address, config);
      result.pending = false;
      if(requestId === lastVerificationId){
        setTokenStatus(context, result);
      }
      return result;
    } catch (error) {
      if(requestId === lastVerificationId){
        setTokenStatus(context, {
          provider: PROVIDER_NAME,
          address,
          mint: config.mint,
          rpcUrl: config.rpcUrl,
          verified: false,
          pending: false,
          reason: 'verification_error',
          error: String(error && error.message ? error.message : error),
          saleUrl: config.saleUrl,
          checkedAt: new Date().toISOString()
        });
      }
      return null;
    }
  }

  function ensureManualConnect(provider, onConnect){
    if(manualConnectHandler) return;
    manualConnectHandler = async function(){
      document.removeEventListener('click', manualConnectHandler, true);
      const handler = manualConnectHandler;
      manualConnectHandler = null;
      try {
        const resp = await provider.connect();
        if(resp && resp.publicKey){
          await onConnect(resp);
        } else if(provider.publicKey){
          await onConnect({ publicKey: provider.publicKey });
        }
      } catch (err) {
        console.warn('[RedNode] Phantom connection cancelled', err);
        ensureManualConnect(provider, onConnect);
      }
    };
    document.addEventListener('click', manualConnectHandler, { once: true, capture: true });
  }

  function handleDisconnect(provider, handleConnect){
    const context = ensureContext();
    currentProvider = provider || currentProvider;
    setCurrentWallet(null);
    const config = getActiveConfig();
    setTokenStatus(context, {
      provider: PROVIDER_NAME,
      mint: config.mint,
      rpcUrl: config.rpcUrl,
      verified: false,
      reason: 'disconnected',
      saleUrl: config.saleUrl,
      checkedAt: new Date().toISOString()
    });
    if(currentProvider){
      ensureManualConnect(currentProvider, handleConnect || handleConnectFactory(currentProvider));
    }
  }

  function handleConnectFactory(provider){
    return async function(event){
      const context = ensureContext();
      currentProvider = provider;
      const publicKey = event && event.publicKey ? event.publicKey : provider && provider.publicKey;
      if(!publicKey) return;
      const address = typeof publicKey === 'string' ? publicKey : publicKey.toString();
      const wallet = { provider: PROVIDER_NAME, address };
      setCurrentWallet(wallet);
      await runVerification(address);
    };
  }

  function init(){
    const context = ensureContext();
    const storedWallet = load(WALLET_STORAGE_KEY);
    if(storedWallet){
      setCurrentWallet(storedWallet);
      if(storedWallet.address){
        runVerification(storedWallet.address);
      }
    }
    const storedStatus = load(TOKEN_STATUS_KEY);
    if(storedStatus){
      const enriched = { ...storedStatus };
      if(!Object.prototype.hasOwnProperty.call(enriched, 'saleUrl')){
        const config = getActiveConfig();
        if(config && config.saleUrl) enriched.saleUrl = config.saleUrl;
      }
      context.tokenVerification = enriched;
      updateGate(enriched);
    } else {
      updateGate(null);
    }

    const api = window.RedNodeWallet = window.RedNodeWallet || {};
    api.getWallet = function(){
      const ctx = ensureContext();
      return ctx.wallet ? { ...ctx.wallet } : null;
    };
    api.getTokenStatus = function(){
      const ctx = ensureContext();
      return ctx.tokenVerification ? { ...ctx.tokenVerification } : null;
    };
    api.getConfig = function(){
      const active = getActiveConfig();
      return { ...active };
    };
    api.setConfig = function(nextConfig){
      const updated = mergeConfig({ ...getActiveConfig() }, nextConfig || {});
      const committed = commitConfig(updated);
      checkMintContract(committed).then(applyContractStatus);
      const wallet = api.getWallet();
      if(wallet && wallet.address){
        runVerification(wallet.address);
      }
      return api.getConfig();
    };
    api.clearConfig = function(){
      return api.setConfig({ mint: null, rpcUrl: DEFAULT_RPC, saleUrl: DEFAULT_SALE_URL });
    };
    api.refreshVerification = function(){
      const wallet = api.getWallet();
      if(wallet && wallet.address){
        runVerification(wallet.address);
      }
    };
    Object.defineProperty(api, 'provider', {
      configurable: true,
      enumerable: true,
      get(){
        return currentProvider || null;
      }
    });
    Object.defineProperty(api, 'mint', {
      configurable: true,
      enumerable: true,
      get(){
        return getActiveConfig().mint;
      },
      set(value){
        api.setConfig({ mint: value });
      }
    });
    Object.defineProperty(api, 'rpcUrl', {
      configurable: true,
      enumerable: true,
      get(){
        return getActiveConfig().rpcUrl;
      },
      set(value){
        api.setConfig({ rpcUrl: value });
      }
    });
    Object.defineProperty(api, 'saleUrl', {
      configurable: true,
      enumerable: true,
      get(){
        return getActiveConfig().saleUrl;
      },
      set(value){
        api.setConfig({ saleUrl: value });
      }
    });

    const config = resolveInitialConfig();
    checkMintContract(config).then(applyContractStatus);
    const provider = window.solana;
    currentProvider = provider;

    if(!provider || !provider.isPhantom){
      setTokenStatus(context, {
        provider: PROVIDER_NAME,
        mint: config.mint,
        rpcUrl: config.rpcUrl,
        verified: false,
        reason: 'provider_unavailable',
        saleUrl: config.saleUrl,
        checkedAt: new Date().toISOString()
      });
      return;
    }

    const handleConnect = handleConnectFactory(provider);
    connectHandler = handleConnect;

    provider.on && provider.on('connect', handleConnect);
    provider.on && provider.on('disconnect', () => handleDisconnect(provider, handleConnect));
    provider.on && provider.on('accountChanged', (pubKey) => {
      if(pubKey){
        handleConnect({ publicKey: pubKey });
      } else {
        handleDisconnect(provider, handleConnect);
      }
    });

    if(provider.isConnected && provider.publicKey){
      handleConnect({ publicKey: provider.publicKey });
    } else {
      provider.connect({ onlyIfTrusted: true })
        .then((resp) => {
          if(resp && resp.publicKey){
            return handleConnect(resp);
          }
          if(provider.publicKey){
            return handleConnect({ publicKey: provider.publicKey });
          }
          return null;
        })
        .catch((err) => {
          console.info('[RedNode] Phantom auto-connect skipped', err && err.message ? err.message : err);
        })
        .finally(() => {
          if(!provider.isConnected || !provider.publicKey){
            ensureManualConnect(provider, handleConnect);
          }
        });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

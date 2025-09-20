(function(){
  'use strict';

  const WALLET_STORAGE_KEY = 'rednode_wallet';
  const TOKEN_STATUS_KEY = 'rednode_token_status';
  const WALLET_CONFIG_KEY = 'rednode_wallet_config';
  const PROVIDER_NAME = 'phantom';
  const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

  let manualConnectHandler = null;
  let currentContext = null;
  let currentProvider = null;
  let currentConfig = null;
  let lastVerificationId = 0;

  const DEFAULT_CONFIG = Object.freeze({ mint: null, rpcUrl: DEFAULT_RPC });

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

  function sanitizeConfig(partial){
    const result = {};
    if(partial && Object.prototype.hasOwnProperty.call(partial, 'mint')){
      result.mint = normalizeMint(partial.mint);
    }
    if(partial && Object.prototype.hasOwnProperty.call(partial, 'rpcUrl')){
      result.rpcUrl = normalizeRpcUrl(partial.rpcUrl);
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
    return base;
  }

  function commitConfig(config){
    const context = ensureContext();
    const nextConfig = {
      mint: normalizeMint(config && config.mint),
      rpcUrl: normalizeRpcUrl(config && config.rpcUrl)
    };
    currentConfig = nextConfig;
    context.walletConfig = { ...nextConfig };
    context.requiredTokenMint = nextConfig.mint;
    context.solanaRpcUrl = nextConfig.rpcUrl;
    persist(WALLET_CONFIG_KEY, nextConfig);
    const globalCfg = window.REDNODE_CONFIG = window.REDNODE_CONFIG || {};
    if(Object.prototype.hasOwnProperty.call(nextConfig, 'mint')){
      globalCfg.requiredTokenMint = nextConfig.mint;
    }
    if(Object.prototype.hasOwnProperty.call(nextConfig, 'rpcUrl')){
      globalCfg.rpcUrl = nextConfig.rpcUrl;
    }
    broadcast('rednode-wallet-config', { ...nextConfig });
    return nextConfig;
  }

  function resolveInitialConfig(){
    ensureContext();
    const fromMeta = {
      mint: readMeta('rednode-token-mint'),
      rpcUrl: readMeta('rednode-rpc-url')
    };
    const stored = load(WALLET_CONFIG_KEY);
    const globalCfg = window.REDNODE_CONFIG || {};
    const base = { ...DEFAULT_CONFIG };
    mergeConfig(base, fromMeta);
    mergeConfig(base, stored);
    mergeConfig(base, {
      mint: globalCfg.requiredTokenMint,
      rpcUrl: globalCfg.rpcUrl
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

  function setTokenStatus(context, status){
    currentContext = context;
    if(status){
      context.tokenVerification = status;
      persist(TOKEN_STATUS_KEY, status);
    } else {
      delete context.tokenVerification;
      persist(TOKEN_STATUS_KEY, null);
    }
    broadcast('rednode-token-status', status);
  }

  async function runVerification(address){
    if(!address) return null;
    const context = ensureContext();
    const config = getActiveConfig();
    const requestId = ++lastVerificationId;
    const pendingStatus = {
      provider: PROVIDER_NAME,
      address,
      mint: config.mint,
      rpcUrl: config.rpcUrl,
      verified: false,
      pending: true,
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
    }
    const storedStatus = load(TOKEN_STATUS_KEY);
    if(storedStatus){
      context.tokenVerification = storedStatus;
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
      commitConfig(updated);
      const wallet = api.getWallet();
      if(wallet && wallet.address){
        runVerification(wallet.address);
      }
      return api.getConfig();
    };
    api.clearConfig = function(){
      return api.setConfig({ mint: null, rpcUrl: DEFAULT_RPC });
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

    const config = resolveInitialConfig();
    const provider = window.solana;
    currentProvider = provider;

    if(!provider || !provider.isPhantom){
      setTokenStatus(context, {
        provider: PROVIDER_NAME,
        mint: config.mint,
        rpcUrl: config.rpcUrl,
        verified: false,
        reason: 'provider_unavailable',
        checkedAt: new Date().toISOString()
      });
      return;
    }

    const handleConnect = handleConnectFactory(provider);

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

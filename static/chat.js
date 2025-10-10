(function(){
  let chatSocket = null;
  function createBox(){
    const ctx = window.APP_CONTEXT || {};
    const box = document.createElement('div');
    box.id = 'chat-box';
      Object.assign(box.style, {
        position: 'fixed',
        top: '0',
        bottom: '0',
        left: '0',
        width: '50%',
        background: 'linear-gradient(160deg, rgba(8,12,26,0.92), rgba(8,12,26,0.78))',
        color: '#f5f7ff',
        borderRight: '1px solid rgba(123,157,255,0.35)',
        padding: '16px',
        fontSize: '14px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        backdropFilter: 'blur(18px)',
        boxShadow: '0 28px 48px rgba(5,8,22,0.55)'
      });
      if(window.innerWidth < 600){
        box.style.width = '100%';
      }
      box.innerHTML =
      '<div id="chat-users" style="margin-bottom:8px;font-weight:600;color:#9aa3c8;"></div>' +
      '<div style="margin-bottom:12px;">' +
      '<input id="chat-search" placeholder="Search..." style="width:100%;padding:10px;background:rgba(16,24,46,0.72);border:1px solid rgba(123,157,255,0.35);color:#f5f7ff;border-radius:12px;box-shadow:0 16px 28px rgba(5,8,22,0.4);" />' +
      '</div>' +
      '<div id="chat-feed" style="overflow-y:auto;flex:1;margin-bottom:12px;background:rgba(10,16,34,0.7);padding:12px;border-radius:18px;border:1px solid rgba(123,157,255,0.3);box-shadow:0 28px 48px rgba(5,8,22,0.45);backdrop-filter:blur(12px);"></div>' +
      '<form id="chat-form" style="display:flex;gap:10px;align-items:center;background:rgba(12,20,42,0.75);padding:10px;border-radius:14px;border:1px solid rgba(123,157,255,0.3);">' +
      '<input id="chat-input" style="flex:1;padding:10px 12px;background:transparent;border:0;color:#f5f7ff;outline:none;" />' +
      '<input id="chat-file" type="file" style="width:120px;padding:10px;border-radius:12px;background:rgba(16,24,46,0.72);border:1px solid rgba(123,157,255,0.35);color:#f5f7ff;cursor:pointer;" />' +
      '<button style="padding:10px 16px;border-radius:12px;background:linear-gradient(135deg,#ff4d8d,#ff7a5c);color:#050814;font-weight:600;border:0;box-shadow:0 18px 32px rgba(255,87,136,0.4);cursor:pointer;">Send</button>' +
      '</form>';
    document.body.appendChild(box);

    const usersBox = box.querySelector('#chat-users');
    const feed = box.querySelector('#chat-feed');
    const form = box.querySelector('#chat-form');
    const input = box.querySelector('#chat-input');
    const fileInput = box.querySelector('#chat-file');
    const search = box.querySelector('#chat-search');
    usersBox.style.textTransform = 'uppercase';
    usersBox.style.letterSpacing = '0.12em';
    usersBox.style.fontSize = '11px';
    const sendAllowed = !!ctx.username;
    const socket = io();
    chatSocket = socket;
    socket.on('connect', () => {
      socket.emit('get_chat_history');
    });
    function appendMsg(data){
      const msg = document.createElement('div');
      msg.style.marginBottom = '10px';
      msg.style.padding = '12px';
      msg.style.background = 'rgba(16,24,46,0.72)';
      msg.style.borderRadius = '14px';
      msg.style.border = '1px solid rgba(123,157,255,0.25)';
      msg.style.boxShadow = '0 16px 30px rgba(5,8,22,0.45)';
      const header = document.createElement('div');
      const text = data.message ? ` ${data.message}` : '';
      header.textContent = `${data.user}:${text}`;
      header.style.color = '#7b9dff';
      header.style.textShadow = '0 0 8px rgba(123,157,255,0.5)';
      header.style.fontWeight = '600';
      msg.appendChild(header);
      const fileName = data.file_name || data.fileName;
      const fileType = data.file_type || data.fileType || '';
      if(data.image){
        const img = document.createElement('img');
        img.src = data.image;
        img.alt = fileName || data.message || 'image';
        img.style.maxWidth = '100%';
        img.style.borderRadius = '12px';
        img.style.marginTop = '8px';
        msg.appendChild(img);
      } else if(data.file){
        const type = fileType;
        if(type.startsWith('video/')){
          const vid = document.createElement('video');
          vid.src = data.file;
          vid.controls = true;
          vid.style.maxWidth = '100%';
          vid.style.borderRadius = '12px';
          vid.style.marginTop = '8px';
          msg.appendChild(vid);
        } else if(type.startsWith('audio/')){
          const aud = document.createElement('audio');
          aud.src = data.file;
          aud.controls = true;
          aud.style.marginTop = '8px';
          msg.appendChild(aud);
        } else {
          const link = document.createElement('a');
          link.href = data.file;
          const name = fileName || 'download';
          link.textContent = name;
          link.download = name;
          link.style.color = '#ff4d8d';
          link.style.fontWeight = '600';
          link.style.display = 'inline-block';
          link.style.marginTop = '6px';
          msg.appendChild(link);
        }
      }
      feed.appendChild(msg);
      feed.scrollTop = feed.scrollHeight;
    }
    function renderMessages(list){
      feed.innerHTML = '';
      list.forEach(appendMsg);
    }
    socket.on('chat_history', renderMessages);
    socket.on('chat_search_results', renderMessages);
    socket.on('chat_message', appendMsg);
    socket.on('chat_error', msg => {
      alert(msg);
    });
    socket.on('active_user_update', data => {
      usersBox.textContent = `Active users (${data.count}): ${data.users.join(', ')}`;
    });
    if(!sendAllowed){
      input.disabled = true;
      input.placeholder = 'Login required to chat';
    }
    let searchTimer = null;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = search.value.trim();
        if(q){
          socket.emit('search_chat', {query: q});
        } else {
          socket.emit('get_chat_history');
        }
      }, 300);
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      if(!sendAllowed){
        alert('Login required to chat');
        return;
      }
      const txt = input.value.trim();
      const file = fileInput.files[0];
      if(file){
        const reader = new FileReader();
        reader.onload = () => {
          const payload = { message: txt };
          if(file.type.startsWith('image/')){
            payload.image = reader.result;
          } else {
            payload.file = reader.result;
          }
            payload.file_name = file.name;
            payload.file_type = file.type;
            payload.fileName = file.name;
            payload.fileType = file.type;
          socket.emit('chat_message', payload);
        };
        reader.readAsDataURL(file);
        fileInput.value = '';
        input.value = '';
      } else if(txt){
        socket.emit('chat_message', { message: txt });
        input.value = '';
      }
    });
    return box;
  }

  window.initChatBox = function(){
    let box = document.getElementById('chat-box');
    if(box){
      const showing = box.style.display === 'none';
      box.style.display = showing ? 'block' : 'none';
      if(showing && chatSocket){
        chatSocket.emit('get_chat_history');
      }
      return;
    }
    createBox();
  };
})();

(function(){
  const updates = [
    'Welcome to our work stream!',
    'Rebranding complete with golden red theme.',
    'Live contact chat is ready.'
  ];
  const feed = document.getElementById('work-stream-feed');
  if(feed){
    updates.forEach(txt => {
      const li = document.createElement('li');
      li.textContent = txt;
      feed.appendChild(li);
    });
  }
})();

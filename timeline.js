document.querySelectorAll('.timeline-item').forEach(item => {
    item.addEventListener('click', () => {
        item.classList.toggle('active');
        console.log("Timeline item clicked:", item); 
    });
});
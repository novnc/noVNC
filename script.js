// target the elements in the DOM used in the project

/**
 * svg for the key and keyhole
 * div nesting the ghost
 * heading and paragraph
 */
const key = document.querySelector(".key");
const keyhole = document.querySelector(".keyhole");
const ghost = document.querySelector(".ghost");

const heading = document.querySelector("h1");
const paragraph = document.querySelector("p");


// for the length of the timout, consider the --animation-duration custom property and add a small delay
// retrieve properties on the root element
const root = document.querySelector(":root");
const rootStyles = getComputedStyle(root);
// retrieve the animation-duration custom property
// ! this is specified as "40s", in seconds, so parse the number and includ it in milliseconds
const animationDuration = parseInt(rootStyles.getPropertyValue("--animation-duration"))*1000;
let keyTimer = animationDuration*9/8;


// retrieve the dimensions of the key (to have the key exactly where the cursor would lie)
const keyBox = key.getBoundingClientRect();
// console.log(keyBox);


// KEY & KEYHOLE ANIMATION
// include a timeout with the specified time frame
const timeoutID = setTimeout(() => {
  // after the specified time, change the cursor as to seemingly grab the key
  key.parentElement.parentElement.style.cursor = "grab";

  // introduce the key and keyhole svg elements by triggering the paused-by-default animation
  key.style.animationPlayState = "running";
  keyhole.style.animationPlayState = "running";

  // ! pointer-events set to none on the key to allow for a mouseover event on the keyhole
  // the key is indeed used in stead of the normal cursor and would overlap on top of everything
  key.style.pointerEvents = "none";

  // when the cursor hovers anywhere in the window, call a function to update the position of the key and have it match the cursor
  window.addEventListener("mousemove", updateKeyPosition);

  // when the cursor hovers on the keyhole, call a function to grant access and remove present listeners
  keyhole.addEventListener("mouseover", grantAccess);

  clearTimeout(timeoutID);
}, keyTimer);


// define the function which updates the position of the absolute-positioned key according to the mouse coordinates (and the keys own dimensions)
const updateKeyPosition = (e) => {
  let x = e.clientX;
  let y = e.clientY;
  key.style.left = x - keyBox.width/1.5;
  key.style.top = y - keyBox.height/2;
};

// define the function which notifies the user of the grant access
const grantAccess = () => {
  // restore the cursor
  key.parentElement.parentElement.style.cursor = "default";

  // change the text of the heading and paragraph elements
  heading.textContent = '🎉 yay 🎉';
  paragraph.textContent = 'access granted';

  // remove the svg elements for the key and keywhole from the flow of the document
  keyhole.style.display = "none";
  key.style.display = "none";

  // remove the event listeners, most notably the one on the window
  window.removeEventListener("mousemove", updateKeyPosition);
  keyhole.removeEventListener("mouseover", grantAccess);
};
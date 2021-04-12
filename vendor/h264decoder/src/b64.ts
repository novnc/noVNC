const key = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

export function decode(input: string) {
  let len = input.length;
  if (input[input.length - 2] === '=') len -= 2;
  else if (input[input.length - 1] === '=') len--; 
  const bytes = ((len / 4) * 3)|0;
	const uarray = new Uint8Array(bytes);
	for (let i = 0, j = 0; i < bytes; i+=3) {	
    const enc1 = key.indexOf(input[j++]);
    const enc2 = key.indexOf(input[j++]);    
    uarray[i] = (enc1 << 2) | (enc2 >> 4);
    if (j === len) break;
    const enc3 = key.indexOf(input[j++] || '=');
    uarray[i+1] = ((enc2 & 15) << 4) | (enc3 >> 2);
    if (j === len) break;
    const enc4 = key.indexOf(input[j++] || '=');
	  uarray[i+2] = ((enc3 & 3) << 6) | enc4;
	}
	
	return uarray;
}
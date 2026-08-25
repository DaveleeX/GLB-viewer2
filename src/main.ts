import './styles/tokens.css';
import './styles/base.css';
import './styles/panels.css';
import { App } from './ui/App';
import WebGL from 'three/addons/capabilities/WebGL.js';

if (!WebGL.isWebGL2Available()) {
  document.body.innerHTML = `
    <div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center;color:#e8eefc;font-family:system-ui">
      <div>
        <h1 style="font-size:20px;margin:0 0 10px">当前浏览器不支持 WebGL 2</h1>
        <p style="color:#8f9bb3;margin:0">请升级到较新版本的 Chrome、Edge、Firefox 或 Safari 后重试。</p>
      </div>
    </div>`;
} else {
  new App();
}

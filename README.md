# PCG World - 程序化内容生成

基于 Three.js + GLSL 的程序化内容生成项目，纯浏览器运行，可部署在 GitHub Pages。

## 功能

- **程序化地形**：平原、山脉、岛屿、近郊、城市 — 基于 Simplex Noise + FBM
- **程序化房屋**：8 种风格（cottage / medieval / modern / nordic / farm / tower / hut / villa），PCG 控制尺寸/颜色/朝向变化
- **聚落系统**：村庄 / 郊区 / 城市，影响房屋密度、间距、风格分布
- **地形感知朝向**：房屋根据地形坡度自动朝向（沿等高线或面向下坡），不再千篇一律
- **碰撞检测**：房屋放置时自动间距检测，防止穿模
- **室内灯光**：开关控制，夜间自动增强，窗户联动发光
- **GLSL 火焰**：基于粒子着色器的实时火焰效果（烟囱/篝火）
- **天气系统**：晴天 / 雨天 / 雪天 / 雾天，全部 GPU 着色器驱动
- **昼夜循环**：太阳位置、天空颜色、光照强度全部随时间变化
- **交互控制**：OrbitControls 支持旋转 / 平移 / 缩放

## 技术栈

- **Three.js** (r160, CDN)
- **GLSL** 着色器（地形、火焰、雨雪）
- **Simplex Noise** (自行实现)
- **ES Modules** + importmap，零构建工具

## 部署

### GitHub Pages

1. 将代码推到 GitHub 仓库
2. 仓库 Settings → Pages → Source 选择 `main` 分支
3. 访问 `https://<username>.github.io/<repo>/`

### 本地运行

任何静态服务器即可，例如：

```bash
npx serve .
# 或
python -m http.server 8000
```

## 操作

- 鼠标左键拖拽：旋转视角
- 鼠标右键拖拽：平移
- 滚轮：缩放
- 左侧面板：控制地形/聚落/天气/火焰/灯光/时间/种子

## 项目结构

```
├── index.html        # 主页面 + UI
├── js/
│   ├── main.js       # 入口，场景管理，UI 绑定
│   ├── terrain.js    # 程序化地形 + GLSL 着色器
│   ├── house.js      # 程序化房屋生成 + 碰撞检测 + 室内灯光
│   ├── fire.js       # GLSL 火焰粒子系统
│   ├── weather.js    # 天气系统（雨/雪/雾 GLSL 着色器）
│   └── noise.js      # Simplex Noise 实现
└── README.md
```

## License

MIT

import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import CompressionPlugin from 'compression-webpack-plugin'
import withBundleAnalyzer from '@next/bundle-analyzer'
import createNextIntlPlugin from 'next-intl/plugin'
import fs from 'fs'
import path from 'path'

// 读取构建版本号
const getBuildVersion = () => {
  // 优先从环境变量读取
  if (process.env.BUILD_VERSION) {
    return process.env.BUILD_VERSION
  }

  // 其次从文件读取
  const versionFile = path.join(process.cwd(), '.build-version')
  if (fs.existsSync(versionFile)) {
    try {
      return fs.readFileSync(versionFile, 'utf-8').trim()
    } catch (error) {
      console.warn('⚠️  无法读取构建版本文件')
    }
  }

  // 默认值（用于开发环境或不使用 CDN 的情况）
  return null
}

// 配置 next-intl
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// 配置 Bundle Analyzer
const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: true,
})

type NextConfigWithLegacyTurbo = NextConfig & {
  experimental?: NextConfig['experimental'] & {
    turbo?: NonNullable<NextConfig['turbopack']>
  }
}

const FALLBACK_APP_BASE_URL = 'https://app.opencreator.io'

const PRODUCT_ROUTE_PREFIXES = [
  'home',
  'skills',
  'projects',
  'workflows',
  'assets',
  'developer/apikeys',
  'canvas',
  'credits',
  'payment-redirect',
  'auth-complete',
  'sso-callback',
  'custom-workflow',
  'content-production',
  'remotion',
  'sign-in',
  'sign-up',
  'verify',
  'tiktok/auth',
  'youtube/auth',
] as const

const normalizeBaseUrl = (url: string) => url.replace(/\/$/, '')

const getAppBaseUrl = () =>
  normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || FALLBACK_APP_BASE_URL)

const createProductRedirects = () => {
  const appBaseUrl = getAppBaseUrl()

  return PRODUCT_ROUTE_PREFIXES.flatMap(prefix => [
    {
      source: `/:locale(en|zh)/${prefix}`,
      destination: `${appBaseUrl}/:locale/${prefix}`,
      permanent: true,
    },
    {
      source: `/:locale(en|zh)/${prefix}/:path*`,
      destination: `${appBaseUrl}/:locale/${prefix}/:path*`,
      permanent: true,
    },
    {
      source: `/${prefix}`,
      destination: `${appBaseUrl}/${prefix}`,
      permanent: true,
    },
    {
      source: `/${prefix}/:path*`,
      destination: `${appBaseUrl}/${prefix}/:path*`,
      permanent: true,
    },
  ])
}

const migrateLegacyTurboConfig = (config: NextConfig): NextConfig => {
  const legacyConfig = config as NextConfigWithLegacyTurbo
  const legacyTurbo = legacyConfig.experimental?.turbo

  if (!legacyTurbo) {
    return config
  }

  legacyConfig.turbopack = {
    ...legacyTurbo,
    ...legacyConfig.turbopack,
    resolveAlias: {
      ...legacyTurbo.resolveAlias,
      ...legacyConfig.turbopack?.resolveAlias,
    },
    rules: {
      ...legacyTurbo.rules,
      ...legacyConfig.turbopack?.rules,
    },
  }

  delete legacyConfig.experimental?.turbo

  return legacyConfig
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,

  // 添加图片优化
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30天缓存
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  compress: true,
  compiler: {
    // 只在生产环境移除 console
    removeConsole: process.env.NODE_ENV === 'production',
    styledComponents: true, // 支持 styled-components
  },
  eslint: {
    // 在构建时忽略 ESLint 检查
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 忽略构建错误
    ignoreBuildErrors: true,
  },
  devIndicators: false,
  turbopack: {
    rules: {
      '*.svg': {
        loaders: [
          {
            loader: '@svgr/webpack',
            options: {
              icon: true,
            },
          },
        ],
        as: '*.js',
      },
    },
  },
  // 确保 Vercel serverless 函数包含 messages 目录下的 JSON 文件
  // request.ts 使用 fs.readdirSync + dynamic import 加载翻译文件，
  // Vercel 默认的 file tracing 无法自动追踪这些文件
  outputFileTracingIncludes: {
    '/*': ['./messages/**/*.json'],
  },
  experimental: {
    // CSS 代码分割
    cssChunking: true,
    // 仅保留最影响构建的包进行优化，减少不必要的处理
    optimizePackageImports: [
      // 图标库 - 这个必须优化，否则会导入所有图标
      'lucide-react',
      // 动画库
      'framer-motion',
      // Hooks 库
      'ahooks',
      // HeroUI 子包按需优化
      '@heroui/image',
      '@heroui/listbox',
      '@heroui/tooltip',
      '@heroui/system',
      // 本地营销组件 barrel，避免页面侧从 index.ts 拉入过多模块
      '@/components/landing',
      '@/components/blog',
      '@/components/landing/model',
    ],
    // 启用并行路由编译（多线程加速构建）
    webpackBuildWorker: true,
  },
  async headers() {
    return [
      {
        source: '/icons/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
  async redirects() {
    return [
      ...createProductRedirects(),
      {
        source: '/:locale(en|zh)/template',
        destination: '/:locale',
        permanent: true,
      },
      {
        source: '/:locale(en|zh)/templates',
        destination: '/:locale',
        permanent: true,
      },
      {
        source: '/template',
        destination: '/',
        permanent: true,
      },
      {
        source: '/templates',
        destination: '/',
        permanent: true,
      },
    ]
  },
  // output: 'export',
  // 生产环境静态资源从 R2 CDN 提供，EC2 只负责 SSR
  // assetPrefix: (() => {
  //   if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  //     const buildVersion = getBuildVersion()
  //     if (buildVersion) {
  //       return `https://web-static.opencreator.io/prod/${buildVersion}`
  //     }
  //   }
  //   return ''
  // })(),

  webpack(config, { isServer }) {
    // 处理 SVG 文件
    config.module.rules.push({
      test: /\.svg$/,
      use: [
        {
          loader: '@svgr/webpack',
          options: {
            icon: true, // Optional: Optimize for SVG icons
          },
        },
      ],
    })

    // 只在生产环境和客户端构建时输出日志
    if (process.env.NODE_ENV === 'production' && !isServer) {
      // 注意：如果 CloudFront 已开启自动压缩（Compress Objects Automatically），
      // 可以跳过构建时压缩以节省约 20-30% 的构建时间
      // CloudFront 会在边缘节点自动进行 gzip/brotli 压缩
      const enableBuildTimeCompression = process.env.ENABLE_BUILD_COMPRESSION === 'true'

      if (enableBuildTimeCompression) {
        // 如果需要预压缩（R2 直接提供压缩文件），只用 brotli（更高效）
        config.plugins.push(
          new CompressionPlugin({
            filename: '[path][base].br',
            algorithm: 'brotliCompress',
            test: /\.(js|css|html|svg)$/,
            threshold: 1024,
            minRatio: 0.5,
          })
        )
      }
    }

    return config
  },
}

// 导出最终的配置
export default async () => {
  const composedConfig =
    process.env.ANALYZE === 'true'
      ? withAnalyzer(withNextIntl(nextConfig))
      : withNextIntl(nextConfig)

  return withSentryConfig(migrateLegacyTurboConfig(composedConfig), {
    // 自动上传 source maps 以便在 Sentry 中看到可读的堆栈
    sourcemaps: {
      deleteSourcemapsAfterUpload: true,
    },

    // 静默 SDK 日志
    silent: !process.env.CI,

    webpack: {
      // 自动为 commit 和 release 关联
      automaticVercelMonitors: true,
    },
  })
}

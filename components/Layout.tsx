import { ReactNode } from 'react'
import { Inter } from 'next/font/google'

import SectionContainer from './SectionContainer'
import Footer from './Footer'
import Header from './Header'

interface Props {
  children: ReactNode
}

const inter = Inter({ subsets: ['latin'], display: 'swap', adjustFontFallback: false })

const LayoutWrapper = ({ children }: Props) => {
  return (
    <>
      <style jsx global>{`
        html {
          font-family: ${inter.style.fontFamily};
        }
      `}</style>

      <SectionContainer>
        <div className={`${inter.className} flex h-screen flex-col justify-between`}>
          <Header />
          <main className="grow">{children}</main>
          <Footer />
        </div>
      </SectionContainer>
    </>
  )
}

export default LayoutWrapper

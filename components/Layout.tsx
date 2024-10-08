import { ReactNode, useEffect } from 'react'
import { signOut, useSession } from 'next-auth/react'
import { Inter } from 'next/font/google'

import SectionContainer from './SectionContainer'
import Footer from './Footer'
import Header from './Header'

interface Props {
  children: ReactNode
}

const inter = Inter({ subsets: ['latin'] })

const LayoutWrapper = ({ children }: Props) => {
  const { data: session } = useSession()

  useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') {
      signOut()
    }
  }, [session])

  return (
    <>
      <style jsx global>{`
        body {
          font-family: ${inter.style.fontFamily};
        }
      `}</style>

      <SectionContainer>
        <div className="flex h-screen flex-col justify-between">
          <Header />
          <main className="grow">{children}</main>
          <Footer />
        </div>
      </SectionContainer>
    </>
  )
}

export default LayoutWrapper

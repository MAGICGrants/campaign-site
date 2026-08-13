import { ReactNode, useEffect } from 'react'
import { useRouter } from 'next/router'
import { signOut, useSession } from 'next-auth/react'
import { Inter } from 'next/font/google'

import AdminNav from './admin/AdminNav'
import SectionContainer from './SectionContainer'
import Footer from './Footer'
import Header from './Header'
import { useFundSlug } from '../utils/use-fund-slug'

interface Props {
  children: ReactNode
}

const inter = Inter({ subsets: ['latin'] })

const LayoutWrapper = ({ children }: Props) => {
  const router = useRouter()
  const fundSlug = useFundSlug()
  const { data: session } = useSession()
  const isAdminRoute = router.pathname.startsWith('/admin')

  useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') {
      if (fundSlug) {
        signOut({
          callbackUrl: `/${fundSlug}/login?email=${encodeURIComponent(session?.user.email)}`,
        })
      } else {
        signOut({ callbackUrl: '/' })
      }
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
          <main className="flex w-full flex-col items-start grow">
            {isAdminRoute && <AdminNav />}
            {children}
          </main>
          <Footer />
        </div>
      </SectionContainer>
    </>
  )
}

export default LayoutWrapper

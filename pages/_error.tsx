function ErrorPage({ statusCode }: { statusCode: number }) {
  if (statusCode === 404) {
    return <div className="m-auto text-center text-xl">404 - This page could not be found.</div>
  }
  return <div className="m-auto text-center text-xl">An error occurred.</div>
}
 
ErrorPage.getInitialProps = ({ res, err }: { res: { statusCode: number }, err: { statusCode: number } }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404
  return { statusCode }
}
 
export default ErrorPage